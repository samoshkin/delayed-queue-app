const express = require('express');

module.exports = services => {
  const { queue } = services;

  const app = express();
  app.use(express.json());
  app.post('/', onScheduleJobHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  async function onScheduleJobHandler(req, res) {
    const { payload, dueTime } = req.body;
    const jobId = await queue.scheduleJob(payload, dueTime);
    res.json({ jobId });
  }

  function errorHandler(err, _req, res, _next) {
    console.error(err);
    return res.status(500).json({ message: `${err}` });
  }

  function notFoundHandler(_req, res) {
    return res.status(404).json({ message: 'not found' });
  };

  return app;
};
