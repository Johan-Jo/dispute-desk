const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, label) {
  if (!DATE_PATTERN.test(value || "")) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return date;
}

export function reportingWindow(fromValue, toValue) {
  const from = parseDate(fromValue, "Report start");
  const to = parseDate(toValue, "Report end");
  if (from >= to) throw new Error("Report end must be after report start");
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days: (to - from) / 86400000,
  };
}

export function isSyntheticDispute(row) {
  const gid = row.dispute_gid || "";
  const snapshot = row.raw_snapshot;
  const snapshotText = snapshot && typeof snapshot === "object"
    ? JSON.stringify(snapshot)
    : "";
  return /(?:test-|seed-|dd-seed|e2e|fixture|mock)/i.test(gid) ||
    /"(?:seed|seed_v2|synthetic|fixture|e2e)"\s*:\s*(?:true|"true")/i.test(snapshotText);
}
