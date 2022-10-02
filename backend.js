const { BlobServiceClient } = require('@azure/storage-blob');

const express = require('express')

const axios = require('axios');
const app = express()
const port = 8080
const dotenv = require('dotenv')
dotenv.config()


const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!AZURE_STORAGE_CONNECTION_STRING) {
    throw Error("Azure Storage Connection string not found");
}
const AZURE_STORAGE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME;
if (!AZURE_STORAGE_CONTAINER_NAME) {
    throw Error("Azure Storage Container name not found");
}

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER_NAME);
containerClient.create().then(() => {}, () => {});

async function streamToText(readable) {
    readable.setEncoding('utf8');
    let data = '';
    for await (const chunk of readable) {
        data += chunk;
    }
    return data;
}

var lastTleUpdate = new Date()
var lastStationsUpdate = new Date()

function parseTLE(data) {
    var lines = data.split("\n")
    var tle = {}
    for (let i = 0; i < lines.length - 1; i += 3) {
        var id = lines[i + 2].split(' ')[1].trim()
        tle[id] = lines[i] + "\n" + lines[i + 1] + "\n" + lines[i + 2]
    }
    return tle
}

async function updateTleFile() {
    console.log("Updating TLEs")
    tle = await axios('https://www.celestrak.com/NORAD/elements/active.txt')
    tleData = parseTLE(tle.data)
    // Write the TLE file to the Blob storage
    const data = JSON.stringify(tleData);
    await containerClient.getBlockBlobClient("tle.json").upload(data, data.length);
}

async function updateStationsFile() {
    return new Promise(async (resolve, reject) => {

        console.log("Updating Stations")
        var stations = []
        var done = false;
        var page = 1;
        do {
            var reqStr = "https://network.satnogs.org/api/stations/?page=" + page
            page++
            try {
                var body = await axios(reqStr)
                let data = body.data
                console.log(data)
                data.forEach(el => {
                    stations.push(el)
                });
            } catch (error) {
                console.log(error)
                done = true;
            }
            console.log(stations.length)
        } while (!done);

        // Write the stations file to the Blob storage
        const data = JSON.stringify(stations);
        await containerClient.getBlockBlobClient("stations.json").upload(data, data.length);
    })
}

app.get('/api/tle', async (req, res) => {
    // Check if the TLE file is older than 24 hours
    if (new Date() - lastTleUpdate > 24 * 60 * 60 * 1000) {
        await updateTleFile()
        lastTleUpdate = new Date()
    }
    // Get the TLE file from the Blob storage
    const downloadBlockBlobResponse = await containerClient.getBlockBlobClient("tle.json").download(0);
    const response = await streamToText(downloadBlockBlobResponse.readableStreamBody);
    res.send(response.toString());
})

app.get('/api/stations', async (req, res) => {
    // Check if the stations file is older than 24 hours
    if (new Date() - lastStationsUpdate > 24 * 60 * 60 * 1000) {
        await updateStationsFile()
        lastStationsUpdate = new Date()
    }
    // Get the stations file from the Blob storage
    const downloadBlockBlobResponse = await containerClient.getBlockBlobClient("stations.json").download(0);
    const response = await streamToText(downloadBlockBlobResponse.readableStreamBody);
    res.send(response.toString());
})

updateStationsFile()
updateTleFile()

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})
