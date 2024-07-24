const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const port = 3000;

// Configure AWS SDK
AWS.config.update({
  accessKeyId: 'AKIA2FMKEYMLGV3CRV6P',
  secretAccessKey: '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',
  region: 'us-east-1',
});

const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

// Set up Multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint to handle POST requests
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
      Bucket: 'health-data-raw',
      Key: jsonKey,
      Body: jsonData,
      ContentType: 'application/json',
    }).promise();

    // Upload file to S3
    const fileStream = fs.createReadStream(file.path);
    await s3.upload({
      Bucket: 'health-data-raw',
      Key: fileKey,
      Body: fileStream,
      ContentType: file.mimetype,
    }).promise();

    // Store metadata in DynamoDB
    const params = {
      TableName: 'userUploadData',
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

    res.status(200).send('Successfully uploaded JSON and file to S3 and metadata to DynamoDB.');
  } catch (err) {
    res.status(500).send('Error uploading data.');
    console.error(err);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
