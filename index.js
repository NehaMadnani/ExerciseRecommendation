const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { marked } = require('marked'); // Correct import
require('dotenv').config();

const app = express();
const port = 3000;

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

// Set up Multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Nodemailer to use Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Endpoint to handle POST requests for uploads
app.post('/upload', upload.single('health-data'), async (req, res) => {
  const { name, email, height, weight, age, gender, calories } = req.body;
  const file = req.file;

  if (!name || !email || !height || !weight || !age || !gender || !calories || !file) {
    return res.status(400).send('All fields and file are required.');
  }

  const uploadId = uuidv4();
  const jsonKey = `json/${uploadId}_data.json`;
  const fileKey = `files/${uploadId}_${file.originalname}`;

  try {
    // Upload JSON data to S3
    const jsonData = JSON.stringify({ name, email, height, weight, age, gender, calories });
    await s3.upload({
      Bucket: process.env.YOUR_S3_BUCKET_NAME,
      Key: jsonKey,
      Body: jsonData,
      ContentType: 'application/json',
    }).promise();

    // Upload file to S3
    const fileStream = fs.createReadStream(file.path);
    await s3.upload({
      Bucket: process.env.YOUR_S3_BUCKET_NAME,
      Key: fileKey,
      Body: fileStream,
      ContentType: file.mimetype,
    }).promise();

    // Store metadata in DynamoDB
    const params = {
      TableName: process.env.YOUR_DYNAMODB_TABLE_NAME,
      Item: {
        uploadId,
        name,
        email,
        height,
        weight,
        age,
        gender,
        calories,
        jsonKey,
        fileKey,
        uploadTimestamp: new Date().toISOString(),
      },
    };
    await dynamoDb.put(params).promise();

    // Clean up the local file
    fs.unlink(file.path, (err) => {
      if (err) {
        console.error('Error deleting local file:', err);
      }
    });

    res.status(200).send('Successfully uploaded data.');
  } catch (err) {
    res.status(500).send('Error uploading data.');
    console.error(err);
  }
});

// Endpoint to fetch data from DynamoDB and send email
app.post('/send-email', async (req, res) => {
  const { uploadId, content } = req.body;

  if (!uploadId || !content) {
    return res.status(400).send('uploadId and content are required.');
  }

  try {
    // Fetch data from DynamoDB
    const params = {
      TableName: process.env.YOUR_DYNAMODB_TABLE_NAME,
      Key: { uploadId },
    };
    const data = await dynamoDb.get(params).promise();

    if (!data.Item) {
      return res.status(404).send('Data not found.');
    }

    const { name, email, height, weight, age, gender, calories } = data.Item;

    // Generate the email content
    const markdownContent = `
      Hello ${name},

      Thank you for submitting your health data.

      Here are the details we received:
      - Height: ${height} cm
      - Weight: ${weight} kg
      - Age: ${age}
      - Gender: ${gender}
      - Calories Consumed: ${calories}

      ${content}

      Best regards,
      Health Data Collection Team
    `;

    const htmlContent = marked(markdownContent);

    // Send the email using Nodemailer
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Health Data Submission Confirmation',
      text: markdownContent, // Plain text version
      html: htmlContent, // HTML version
    };

    await transporter.sendMail(mailOptions);

    res.status(200).send('Email sent successfully.');
  } catch (err) {
    res.status(500).send('Error fetching data or sending email.');
    console.error(err);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
