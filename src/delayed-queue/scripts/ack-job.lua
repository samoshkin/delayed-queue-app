-- Positive acknowledgement for a job. Removes job from unackedJobs List and removes job details Hash

-- KEYS[1]: key that points to LIST of unacked jobs
-- KEYS[2]: key that points to HASH of job details
-- ARGV[1]: job ID
local unackedJobsKey = KEYS[1]
local jobDetailsKey = KEYS[2]
local jobId = ARGV[1]

-- remove job from unackedJobs List
local removed = redis.call('LREM', unackedJobsKey, 1, jobId)

-- if successfully removed, remove job details Hash
if removed > 0 then
  redis.call('DEL', jobDetailsKey)
end

return removed
