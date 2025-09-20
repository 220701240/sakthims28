require('dotenv').config();
const express = require('express');
const { OpenAI } = require("openai");
const bodyParser = require('body-parser');

const cors = require('cors');
const multer = require('multer');
const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('./db/dbConfig');
const path = require('path');
const { extractKeyPhrases, recognizeEntities } = require('./aiService');
// CommonJS (Node.js)
const { TextAnalyticsClient, AzureKeyCredential } = require("@azure/ai-text-analytics");

const endpoint = process.env.AZURE_LANGUAGE_ENDPOINT;
const apiKey = process.env.AZURE_LANGUAGE_KEY;

const client = new TextAnalyticsClient(endpoint, new AzureKeyCredential(apiKey));



const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Serve faculty.html


// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// --- Student Routes ---

// List all students
app.get('/api/students', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM Students');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get student by ID
app.get('/api/students/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('StudentID', sql.Int, Number(req.params.id))
      .query('SELECT * FROM Students WHERE StudentID = @StudentID');
    if (!result.recordset.length) return res.status(404).send('Student not found');
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Add student
app.post('/api/students', async (req, res) => {
  const { RollNumber, FirstName, LastName, Email, ResumeUrl } = req.body || {};
  if (!RollNumber || !FirstName || !LastName || !Email) {
    return res.status(400).send('Missing required fields');
  }
  try {
    const pool = await getPool();
    const request = pool
      .request()
      .input('RollNumber', sql.VarChar, RollNumber)
      .input('FirstName', sql.NVarChar, FirstName)
      .input('LastName', sql.NVarChar, LastName)
      .input('Email', sql.NVarChar, Email);
    
    if (ResumeUrl !== undefined) request.input('ResumeUrl', sql.NVarChar, ResumeUrl);

    const query = ResumeUrl
      ? 'INSERT INTO Students (RollNumber, FirstName, LastName, Email, ResumeUrl) VALUES (@RollNumber, @FirstName, @LastName, @Email, @ResumeUrl)'
      : 'INSERT INTO Students (RollNumber, FirstName, LastName, Email) VALUES (@RollNumber, @FirstName, @LastName, @Email)';

    await request.query(query);
    res.status(201).send('Student added');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Update student
app.put('/api/students/:id', async (req, res) => {
  const { RollNumber, FirstName, LastName, Email, ResumeUrl } = req.body || {};
  if ([RollNumber, FirstName, LastName, Email, ResumeUrl].every(v => v === undefined)) {
    return res.status(400).send('No fields to update');
  }
  try {
    const pool = await getPool();
    const updates = [];
    const request = pool.request().input('StudentID', sql.Int, Number(req.params.id));

    if (RollNumber !== undefined) { updates.push('RollNumber=@RollNumber'); request.input('RollNumber', sql.VarChar, RollNumber); }
    if (FirstName !== undefined) { updates.push('FirstName=@FirstName'); request.input('FirstName', sql.NVarChar, FirstName); }
    if (LastName !== undefined) { updates.push('LastName=@LastName'); request.input('LastName', sql.NVarChar, LastName); }
    if (Email !== undefined) { updates.push('Email=@Email'); request.input('Email', sql.NVarChar, Email); }
    if (ResumeUrl !== undefined) { updates.push('ResumeUrl=@ResumeUrl'); request.input('ResumeUrl', sql.NVarChar, ResumeUrl); }

    const query = `UPDATE Students SET ${updates.join(', ')} WHERE StudentID=@StudentID`;
    const result = await request.query(query);
    if (result.rowsAffected[0] === 0) return res.status(404).send('Student not found');
    res.send('Student updated');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Delete student
app.delete('/api/students/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('StudentID', sql.Int, Number(req.params.id))
      .query('DELETE FROM Students WHERE StudentID=@StudentID');
    if (result.rowsAffected[0] === 0) return res.status(404).send('Student not found');
    res.send('Student deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Upload Resume
// 7. Upload Resume
// Upload Resume
 // keep this

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) return res.status(500).send('Azure Storage connection string not configured');

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient('resumes');
    await containerClient.createIfNotExists();

    const blobName = `${Date.now()}-${req.file.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(req.file.buffer);

    // Generate SAS URL (valid 1 hour)
    const sasToken = generateBlobSASQueryParameters({
      containerName: 'resumes',
      blobName,
      expiresOn: new Date(new Date().valueOf() + 3600 * 1000),
      permissions: BlobSASPermissions.parse('r') // read permission
    }, blobServiceClient.credential).toString();

    const sasUrl = `${blockBlobClient.url}?${sasToken}`;
    res.json({ url: sasUrl });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// --- Internship Routes ---

// Get internships for a student
// POST: Add Internship

// -------------------- INTERNSHIP ROUTES --------------------

// Add Internship
app.post('/api/internships', async (req, res) => {
  const { studentId, company, role, startDate, endDate } = req.body;
  if (!studentId || !company || !role || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const pool = await getPool();
    await pool.request()
      .input('StudentID', sql.Int, studentId)
      .input('Company', sql.NVarChar, company)
      .input('Role', sql.NVarChar, role)
      .input('StartDate', sql.Date, startDate)
      .input('EndDate', sql.Date, endDate)
      .query(`INSERT INTO Internships (StudentID, Company, Role, StartDate, EndDate) VALUES (@StudentID, @Company, @Role, @StartDate, @EndDate)`);
    res.json({ message: 'Internship added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all internships (with student name)
app.get('/api/internships', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT i.InternshipID, i.StudentID, s.FirstName, s.LastName,
             i.Company, i.Role, i.StartDate, i.EndDate
      FROM Internships i
      LEFT JOIN Students s ON i.StudentID = s.StudentID
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Internship
app.put('/api/internships/:id', async (req, res) => {
  const { StudentID, Company, Role, StartDate, EndDate } = req.body;
  if ([StudentID, Company, Role, StartDate, EndDate].every(v => v === undefined)) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  try {
    const pool = await getPool();
    const updates = [];
    const request = pool.request().input('InternshipID', sql.Int, Number(req.params.id));
    if (StudentID) { updates.push('StudentID=@StudentID'); request.input('StudentID', sql.Int, StudentID); }
    if (Company) { updates.push('Company=@Company'); request.input('Company', sql.NVarChar, Company); }
    if (Role) { updates.push('Role=@Role'); request.input('Role', sql.NVarChar, Role); }
    if (StartDate) { updates.push('StartDate=@StartDate'); request.input('StartDate', sql.Date, StartDate); }
    if (EndDate) { updates.push('EndDate=@EndDate'); request.input('EndDate', sql.Date, EndDate); }

    const query = `UPDATE Internships SET ${updates.join(', ')} WHERE InternshipID=@InternshipID`;
    const result = await request.query(query);
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Internship not found' });
    res.json({ message: 'Internship updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Internship
app.delete('/api/internships/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('InternshipID', sql.Int, Number(req.params.id))
      .query('DELETE FROM Internships WHERE InternshipID=@InternshipID');
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Internship not found' });
    res.json({ message: 'Internship deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- PLACEMENT ROUTES --------------------

// Add Placement
app.post('/api/placements', async (req, res) => {
  const { studentId, company, role, package: pkg, offerDate } = req.body;
  if (!studentId || !company || !pkg || !offerDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const pool = await getPool();
    await pool.request()
      .input('StudentID', sql.Int, studentId)
      .input('Company', sql.NVarChar, company)
      .input('Role', sql.NVarChar, role || '')
      .input('Package', sql.NVarChar, pkg)
      .input('PlacementDate', sql.Date, offerDate)
      .query(`INSERT INTO Placements (StudentID, Company, Role, Package, PlacementDate) VALUES (@StudentID, @Company, @Role, @Package, @PlacementDate)`);
    res.json({ message: 'Placement added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all placements (with student name)
app.get('/api/placements', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT p.PlacementID, p.StudentID, s.FirstName, s.LastName,
             p.Company, p.Role, p.Package, p.PlacementDate
      FROM Placements p
      LEFT JOIN Students s ON p.StudentID = s.StudentID
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Placement
app.put('/api/placements/:id', async (req, res) => {
  const { StudentID, Company, Role, Package, PlacementDate } = req.body;
  if ([StudentID, Company, Role, Package, PlacementDate].every(v => v === undefined)) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  try {
    const pool = await getPool();
    const updates = [];
    const request = pool.request().input('PlacementID', sql.Int, Number(req.params.id));
    if (StudentID) { updates.push('StudentID=@StudentID'); request.input('StudentID', sql.Int, StudentID); }
    if (Company) { updates.push('Company=@Company'); request.input('Company', sql.NVarChar, Company); }
    if (Role) { updates.push('Role=@Role'); request.input('Role', sql.NVarChar, Role); }
    if (Package) { updates.push('Package=@Package'); request.input('Package', sql.NVarChar, Package); }
    if (PlacementDate) { updates.push('PlacementDate=@PlacementDate'); request.input('PlacementDate', sql.Date, PlacementDate); }

    const query = `UPDATE Placements SET ${updates.join(', ')} WHERE PlacementID=@PlacementID`;
    const result = await request.query(query);
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Placement not found' });
    res.json({ message: 'Placement updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Placement
app.delete('/api/placements/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('PlacementID', sql.Int, Number(req.params.id))
      .query('DELETE FROM Placements WHERE PlacementID=@PlacementID');
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Placement not found' });
    res.json({ message: 'Placement deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/recommendation', async (req, res) => {
  const { studentName, skills } = req.body;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-35-turbo",
      messages: [
        { role: "system", content: "You are an internship recommendation assistant." },
        { role: "user", content: `Suggest 3 internships for student ${studentName} with skills: ${skills}` }
      ]
    });
    res.json({ recommendations: response.choices[0].message.content });
  }catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mock data for recommendations
const internships = [
  { company: "Google", role: "ML Intern" },
  { company: "Microsoft", role: "Cloud Intern" },
  { company: "Amazon", role: "Web Dev Intern" },
  { company: "Facebook", role: "Data Science Intern" },
  { company: "Tesla", role: "AI Intern" }
];


app.post('/api/recommendations', (req, res) => {
  const { skills } = req.body;
  if (!skills) return res.status(400).json({ error: "Skills are required" });

  const skillList = skills.toLowerCase().split(',').map(s => s.trim());

  const recommendations = internships.filter(i =>
    skillList.some(skill => i.role.toLowerCase().includes(skill))
  ).map(i => `${i.company} - ${i.role}`);

  res.json({ recommendations: recommendations.length ? recommendations : ["No match found"] });
});






// -------------------- FRONTEND ROUTE --------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/faculty.html'));
});

// 404 for undefined API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Start server
app.listen(3000, () => console.log('Server running on port 3000'));
