const AWS = require('aws-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const s3 = new AWS.S3();
const sns = new AWS.SNS();

const BUCKET_NAME = process.env.BUCKET_NAME; // Use environment variable
const TOPIC_ARN = process.env.TOPIC_ARN; // Use environment variable
const WEBSITES_FILE_KEY = 'websites.json';

const logGroupName = process.env.AWS_LAMBDA_LOG_GROUP_NAME;
const logStreamName = process.env.AWS_LAMBDA_LOG_STREAM_NAME;

function log(message) {
    console.log(`[${new Date().toISOString()}] [${logGroupName}/${logStreamName}] ${message}`);
}

async function getWebsites() {
    try {
        log('Fetching websites list from S3...');
        const s3Data = await s3.getObject({ Bucket: BUCKET_NAME, Key: WEBSITES_FILE_KEY }).promise();
        log('Websites list fetched successfully.');
        return JSON.parse(s3Data.Body.toString());
    } catch (error) {
        log(`Error fetching websites list: ${error.message}`);
        throw error;
    }
}

async function scrapeWebsite(site) {
    try {
        log(`Scraping website: ${site.name} (${site.url})`);
        const response = await axios.get(site.url);
        const $ = cheerio.load(response.data);
        const products = [];

        $('.product-item').each((_, el) => {
            const name = $(el).find('.product-name').text().trim();
            const price = $(el).find('.product-price').text().trim();
            const link = $(el).find('a').attr('href');
            products.push({ name, price, link });
        });

        log(`Scraping completed for website: ${site.name}. Found ${products.length} products.`);
        return products;
    } catch (error) {
        log(`Error scraping ${site.name}: ${error.message}`);
        return [];
    }
}

async function detectChanges(site, newProducts) {
    const fileKey = site.fileKey;
    let existingData = [];

    try {
        log(`Fetching existing data for ${site.name} from S3...`);
        const s3Data = await s3.getObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
        existingData = JSON.parse(s3Data.Body.toString());
        log(`Existing data fetched for ${site.name}.`);
    } catch (err) {
        if (err.code !== 'NoSuchKey') {
            log(`Error fetching existing data for ${site.name}: ${err.message}`);
            throw err;
        } else {
            log(`No existing data found for ${site.name}.`);
        }
    }

    const newItems = newProducts.filter(p => !existingData.some(e => e.name === p.name));

    if (newItems.length > 0) {
        log(`New products detected for ${site.name}: ${newItems.length} items.`);
        const message = `New products detected on ${site.name}:\n` +
            newItems.map(p => `${p.name} - ${p.price} - ${p.link}`).join('\n');

        try {
            log(`Sending notification for ${site.name}...`);
            await sns.publish({ TopicArn: TOPIC_ARN, Message: message }).promise();
            log(`Notification sent for ${site.name}.`);
        } catch (err) {
            log(`Error sending notification for ${site.name}: ${err.message}`);
        }

        try {
            log(`Updating data for ${site.name} in S3...`);
            await s3.putObject({
                Bucket: BUCKET_NAME,
                Key: fileKey,
                Body: JSON.stringify(newProducts),
                ContentType: 'application/json',
            }).promise();
            log(`Data updated for ${site.name}.`);
        } catch (err) {
            log(`Error updating data for ${site.name}: ${err.message}`);
        }
    } else {
        log(`No changes detected for ${site.name}.`);
    }
}

async function main() {
    try {
        log('Starting main function...');
        const websites = await getWebsites();

        // Process websites concurrently
        await Promise.all(websites.map(async (site) => {
            const newProducts = await scrapeWebsite(site);
            await detectChanges(site, newProducts);
        }));

        log('Main function completed successfully.');
    } catch (error) {
        log(`Error in main function: ${error.message}`);
    }
}

// Lambda handler function
exports.handler = async (event, context) => {
    try {
        await main();
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Scraping completed successfully' })
        };
    } catch (error) {
        log(`Handler error: ${error.message}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};