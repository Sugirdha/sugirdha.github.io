# Curio blog failure-suppression deployment

This change must be deployed on the Curio host together with the Notion schema
and repository changes. It has not been deployed from this repository.

## Pending-row filter

Replace the existing `Publish request OR Update request` filter with:

```js
const pendingBlogRequestFilter = {
  and: [
    {
      or: [
        { property: "Publish request", checkbox: { equals: true } },
        { property: "Update request", checkbox: { equals: true } },
      ],
    },
    {
      or: [
        {
          property: "Automation state",
          select: { equals: "Ready" },
        },
        {
          property: "Automation state",
          select: { is_empty: true },
        },
        { property: "Retry request", checkbox: { equals: true } },
      ],
    },
  ],
};
```

Do not clear either publication request in Curio. `blog-publish.js` clears the
appropriate request only after the Git commit and all intended assets have been
verified on `origin/main`, and the completed Notion state has been written.

## Workflow-level circuit breaker

The existing active-run check remains the overlap guard. Add a separate circuit
breaker for failures that happen before `blog-poll.js` can record an article
failure, such as checkout, dependency setup, or runner failure.

Persist this state outside the Curio process, for example in
`/var/lib/curio/blog-publisher-state.json`, written atomically using a temporary
file followed by rename:

```json
{
  "consecutiveInfrastructureFailures": 0,
  "lastObservedRunId": null,
  "suppressedUntil": null,
  "lastFailureUrl": null
}
```

On each two-minute timer invocation:

1. Read the state file and inspect the most recent `blog-poll.yml` run.
2. Process a completed run only when its ID differs from `lastObservedRunId`.
3. If it failed and no pending Notion row was changed to `Automation state = Failed`
   during that run, classify it as an infrastructure failure and increment the
   counter. Do not treat an article failure recorded by `blog-poll.js` as an
   infrastructure failure.
4. Reset the counter after a successful workflow run.
5. After three consecutive infrastructure failures, set `suppressedUntil` to six
   hours in the future and stop automatic dispatches during that interval.
6. Keep polling Notion and GitHub every two minutes while suppressed, but do not
   dispatch. Log the last failure URL once when the breaker opens.
7. Permit an explicit operator command to reset the breaker after the underlying
   infrastructure problem is fixed. Do not use a new Notion article retry click
   to reset the global infrastructure breaker.

For a dispatch transport timeout, query recent workflow runs before retrying so
an accepted but ambiguously acknowledged dispatch is not duplicated. Retry HTTP
`5xx`, connection failures, and timeouts with bounded delays of 5, 15, and 30
seconds. Treat HTTP `401`, `403`, `404`, and `422` as persistent configuration or
request errors and open the breaker without repeated dispatch attempts.

The state file contains run IDs, timestamps, counters, and URLs only. Never store
GitHub tokens, Notion tokens, request headers, or response bodies in it or in the
systemd journal.

## Deployment order

1. Add the four Notion properties and Retry button described in the repository
   handoff.
2. Deploy the Curio filter and circuit breaker while leaving its timer interval
   unchanged.
3. Deploy the repository changes.
4. Confirm a no-request run succeeds before enabling author buttons again.
