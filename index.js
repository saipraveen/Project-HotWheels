const AWS = require('aws-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const s3 = new AWS.S3();
const sns = new AWS.SNS();

const BUCKET_NAME = 'your-s3-bucket-name'; // Replace with your bucket name
const TOPIC_ARN = 'your-sns-topic-arn'; // Replace with your SNS topic ARN
const WEBSITES_FILE_KEY = 'websites.json';

async function getWebsites() {
    const s3Data = await s3.getObject({ Bucket: BUCKET_NAME, Key: WEBSITES_FILE_KEY }).promise();
    return JSON.parse(s3Data.Body.toString());
}

async function scrapeWebsite(site) {
    try {
        const response = await axios.get(site.url);
        const $ = cheerio.load(response.data);
        const products = [];

        $('.product-item').each((_, el) => {
            const name = $(el).find('.product-name').text().trim();
            const price = $(el).find('.product-price').text().trim();
            const link = $(el).find('a').attr('href');
            products.push({ name, price, link });
        });

        return products;
    } catch (error) {
        console.error(`Error scraping ${site.name}:`, error);
        return [];
    }
}

async function detectChanges(site, newProducts) {
    const fileKey = site.fileKey;
    let existingData = [];

    try {
        const s3Data = await s3.getObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
        existingData = JSON.parse(s3Data.Body.toString());
    } catch (err) {
        if (err.code !== 'NoSuchKey') throw err; // Ignore if file doesn't exist
    }

    const newItems = newProducts.filter(p => !existingData.some(e => e.name === p.name));

    if (newItems.length > 0) {
        const message = `New products detected on ${site.name}:
` +
            newItems.map(p => `${p.name} - ${p.price} - ${p.link}`).join('\n');

        await sns.publish({ TopicArn: TOPIC_ARN, Message: message }).promise();

        await s3.putObject({
            Bucket: BUCKET_NAME,
            Key: fileKey,
            Body: JSON.stringify(newProducts),
            ContentType: 'application/json',
        }).promise();

        console.log(`Changes detected and updated for ${site.name}`);
    } else {
        console.log(`No changes detected for ${site.name}`);
    }
}

async function main() {
    const websites = await getWebsites();

    for (const site of websites) {
        const newProducts = await scrapeWebsite(site);
        await detectChanges(site, newProducts);
    }
}

main().catch(console.error);