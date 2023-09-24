-- Negative acknowledgement for a job. Removes job from unackedJobs List and returns it back to dueJobs List

-- KEYS[1]: key that points to LIST of unacked jobs
-- KEYS[2]: key that points to LIST of due jobs
-- ARGV[1]: job ID
local unackedJobsKey = KEYS[1]
local dueJobsKey = KEYS[2]
local jobId = ARGV[1]

-- remove job from unackedJobs List
local removed = redis.call('LREM', unackedJobsKey, 1, jobId)

-- if successfully removed, add it back to dueJobs list
if removed > 0 then
    redis.call('LPUSH', dueJobsKey, jobId)
end

return removed
