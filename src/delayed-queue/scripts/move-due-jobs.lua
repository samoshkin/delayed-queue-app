-- Migrate jobs from the 'allJobs' SortedSet to 'dueJobs' List
-- Due jobs are jobs satisfying the condition 'job.due_time <= current_time'
--
-- KEYS[1]: key which points to 'allJobs' SortedSet
-- KEYS[2]: key which points to 'dueJobs' List
-- ARGV[1]: current time
-- ARGV[2]: max number of jobs to migrate
local allJobsKey = KEYS[1]
local dueJobsKey = KEYS[2]
local currentTime = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local hasMore = 0

-- take all jobs having their "due_time <= current_time"
local dueJobs = redis.call('ZRANGEBYSCORE', allJobsKey, '-inf', currentTime, 'LIMIT', 0, limit + 1)

-- detect if there're more jobs beyond given max limit
-- if so, remove last extra item from the table
if #dueJobs > limit then
  hasMore = 1
  table.remove(dueJobs)
end

-- move due jobs to the 'dueJobs' LIST
for i = 1, #dueJobs do
  local jobId = dueJobs[i]
  redis.call('LPUSH', dueJobsKey, jobId)
  redis.call('ZREM', allJobsKey, jobId)
end

-- return boolean flag indicating if there're more due jobs to move
return hasMore
