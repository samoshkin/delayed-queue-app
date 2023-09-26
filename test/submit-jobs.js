#!/usr/bin/env node

const { submitJobs } = require('./utils');
const supertest = require('supertest');

const now = Math.floor(Date.now() / 1000);
const jobCount = Number(process.env.JOB_COUNT) || 50;
const timeOffset = Number(process.env.TIME_OFFSET_SEC) || 20;

submitJobs(jobCount, now + 2, timeOffset, scheduleJob);

async function scheduleJob(jobNumber, dueTime) {
  const response = await supertest(process.env.API_ENDPOINT)
    .post('/')
    .send({ dueTime, payload: `job #${jobNumber}` })
    .set('Accept', 'application/json')
    .expect('Content-Type', /json/)
    .expect(200);
  const { jobId } = response.body;
  return jobId;
}
