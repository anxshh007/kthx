import { useEffect, useState } from 'react';
import type { JobRecord } from '@kathix/kernel';
import { Button, Meter, api, useServerEvents, useStudio } from '@kathix/ui';

/** Long tasks run here with progress and cancel; they never block navigation. */
export function JobsTray() {
  const { attempt } = useStudio();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    api
      .get<{ jobs: JobRecord[] }>('/api/jobs')
      .then((r) => setJobs(r.jobs))
      .catch(() => undefined);
  }, []);

  useServerEvents(['job'], (_e, data) => {
    const job = data as JobRecord;
    setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)].slice(0, 30));
  });

  const visible = jobs.filter(
    (j) =>
      !hidden.has(j.id) &&
      (j.status === 'queued' || j.status === 'running' || j.status === 'failed'),
  );
  if (!visible.length) return null;
  return (
    <aside className="jobs-tray" aria-label="Background tasks">
      {visible.slice(0, 4).map((j) => (
        <div className="job" key={j.id} role="status">
          <div className="row spread">
            <strong>{j.label}</strong>
            <span className="muted small">
              {j.status === 'failed'
                ? 'Stopped'
                : j.status === 'queued'
                  ? 'Waiting'
                  : `${Math.round(j.progress * 100)}%`}
            </span>
          </div>
          {j.status !== 'failed' && (
            <Meter value={j.progress * 100} label={`${j.label} progress`} />
          )}
          <span className="small muted">{j.status === 'failed' ? j.error : j.message}</span>
          <div className="row">
            {j.status === 'failed' ? (
              <>
                <Button
                  size="small"
                  onClick={() => void attempt(() => api.post(`/api/jobs/${j.id}/retry`))}
                >
                  Try again
                </Button>
                <Button
                  size="small"
                  kind="ghost"
                  onClick={() => setHidden((h) => new Set(h).add(j.id))}
                >
                  Dismiss
                </Button>
              </>
            ) : (
              <Button
                size="small"
                kind="ghost"
                onClick={() => void attempt(() => api.post(`/api/jobs/${j.id}/cancel`))}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
