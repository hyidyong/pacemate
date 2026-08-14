function exactSentinel(body, sentinelId) {
  return (
    Array.isArray(body) &&
    body.length === 1 &&
    String(body[0]?.id ?? "") === String(sentinelId)
  );
}

/**
 * Decide one anonymous read check from explicit positive and negative proof.
 *
 * Private tables have no anon SELECT grant in Stage 9, so the expected Data API
 * result is the permission-denied class (401/403). A transport or server error
 * is not authorization evidence. The sole public table must return the exact
 * row that the current probe run created.
 */
export function evaluateReadIsolation({
  intendedPublic,
  sentinelId,
  authorizedStatus,
  authorizedBody,
  authorizedError = null,
  unauthorizedStatus,
  unauthorizedBody,
  unauthorizedError = null,
}) {
  if (authorizedError) {
    return {
      pass: false,
      detail: `authorized sentinel verification failed: ${authorizedError.message ?? authorizedError}`,
    };
  }
  if (authorizedStatus !== 200 || !exactSentinel(authorizedBody, sentinelId)) {
    return {
      pass: false,
      detail: `authorized sentinel was not proven (status ${authorizedStatus ?? "error"}, rows ${
        Array.isArray(authorizedBody) ? authorizedBody.length : "invalid"
      })`,
    };
  }
  if (unauthorizedError) {
    return {
      pass: false,
      detail: `anonymous read could not be verified: ${unauthorizedError.message ?? unauthorizedError}`,
    };
  }

  if (intendedPublic) {
    const pass = unauthorizedStatus === 200 && exactSentinel(unauthorizedBody, sentinelId);
    return {
      pass,
      detail: pass
        ? "authorized and anonymous principals both observed the exact public sentinel"
        : `anonymous principal did not observe the exact public sentinel (status ${
            unauthorizedStatus ?? "error"
          }, rows ${Array.isArray(unauthorizedBody) ? unauthorizedBody.length : "invalid"})`,
    };
  }

  if (unauthorizedStatus !== 401 && unauthorizedStatus !== 403) {
    return {
      pass: false,
      detail: `unexpected anonymous status ${unauthorizedStatus ?? "error"}; expected 401/403 permission denial`,
    };
  }

  return {
    pass: true,
    detail: `authorized principal observed sentinel; anonymous principal received expected ${unauthorizedStatus}`,
  };
}
