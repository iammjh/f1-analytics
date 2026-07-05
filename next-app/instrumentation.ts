export async function register() {
  if (process.env.BACKGROUND_JOBS_ENABLED !== 'true') {
    return;
  }

  const { scheduleJobs } = await import('./lib/jobs');
  scheduleJobs();
}
