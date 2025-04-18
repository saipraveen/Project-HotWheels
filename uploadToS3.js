const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configuration
const BUCKET_NAME = 'your-s3-bucket-name'; // Replace with your bucket name
const FILE_PATH = path.join(__dirname, 'websites.json'); // Path to the JSON file
const FILE_KEY = 'websites.json'; // Key to store the file in S3

// Initialize S3 client
const s3 = new AWS.S3();

async function uploadFileToS3() {
    try {
        // Check if the file exists
        if (!fs.existsSync(FILE_PATH)) {
            console.error(`Error: ${FILE_PATH} does not exist.`);
            return;
        }

        // Read the file content
        const fileContent = fs.readFileSync(FILE_PATH);

        // Upload the file to S3
        const params = {
            Bucket: BUCKET_NAME,
            Key: FILE_KEY,
            Body: fileContent,
            ContentType: 'application/json',
        };

        await s3.upload(params).promise();
        console.log(`File '${FILE_PATH}' successfully uploaded to bucket '${BUCKET_NAME}' as '${FILE_KEY}'.`);
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

// Run the upload function
uploadFileToS3();