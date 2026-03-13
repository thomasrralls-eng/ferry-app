/**
 * bigquery.js — Federated BigQuery queries on client's GA4 360 export
 *
 * We query the client's BQ dataset in-place using their own service account.
 * No data is copied to Ferry infrastructure. The client pays their own BQ costs.
 *
 * The SA must have: roles/bigquery.dataViewer on the dataset
 * + roles/bigquery.jobUser on the billing project
 *
 * GA4 360 BQ export schema: analytics_{propertyId}.events_{YYYYMMDD}
 * Docs: https://support.google.com/analytics/answer/7029846
 */

import { BigQuery } from "@google-cloud/bigquery";

/**
 * Build a BigQuery client authenticated with the client's service account.
 * The client's project is used as the billing project for queries.
 */
function bqClientFromSA(saJson) {
  const credentials = JSON.parse(saJson);
  return new BigQuery({
    credentials,
    projectId: credentials.project_id, // bill queries to client's project
  });
}

/**
 * Query the top event names from the GA4 360 BQ export for the last 30 days.
 *
 * @param {string} bqProjectId   — GCP project containing the BQ dataset
 * @param {string} bqDataset     — Dataset name, e.g. "analytics_123456789"
 * @param {string} saJson        — Service account JSON string
 *
 * Returns:
 * {
 *   events: [{ eventName, count, lastSeen }],  // top 100 events
 *   dateRange: { startDate, endDate },
 *   totalRows: number,
 *   queriedAt: string (ISO),
 * }
 */
export async function queryGA4Events(bqProjectId, bqDataset, saJson) {
  const bq = bqClientFromSA(saJson);

  const query = `
    SELECT
      event_name,
      COUNT(*) AS event_count,
      MAX(TIMESTAMP_MICROS(event_timestamp)) AS last_seen
    FROM \`${bqProjectId}.${bqDataset}.events_*\`
    WHERE
      _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
      AND _TABLE_SUFFIX <= FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    GROUP BY event_name
    ORDER BY event_count DESC
    LIMIT 100
  `;

  const [rows] = await bq.query({ query, location: "US" });

  const events = rows.map((row) => ({
    eventName: row.event_name,
    count: parseInt(row.event_count, 10),
    lastSeen: row.last_seen?.value || null,
  }));

  return {
    events,
    dateRange: { startDate: "30daysAgo", endDate: "today" },
    totalRows: events.length,
    queriedAt: new Date().toISOString(),
  };
}

/**
 * Query key conversion events + their parameter shapes.
 *
 * Returns: [{ eventName, paramKeys: string[], sampleCount }]
 */
export async function queryGA4ConversionDetails(bqProjectId, bqDataset, saJson) {
  const bq = bqClientFromSA(saJson);

  const query = `
    WITH event_params AS (
      SELECT
        event_name,
        ep.key AS param_key,
        COUNT(*) AS occurrence_count
      FROM \`${bqProjectId}.${bqDataset}.events_*\`,
        UNNEST(event_params) AS ep
      WHERE
        _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
        AND event_name NOT IN (
          'session_start', 'first_visit', 'user_engagement',
          'scroll', 'click', 'page_view', 'file_download'
        )
      GROUP BY event_name, param_key
    )
    SELECT
      event_name,
      ARRAY_AGG(param_key ORDER BY occurrence_count DESC LIMIT 30) AS param_keys,
      SUM(occurrence_count) AS total_occurrences
    FROM event_params
    GROUP BY event_name
    ORDER BY total_occurrences DESC
    LIMIT 30
  `;

  const [rows] = await bq.query({ query, location: "US" });

  return rows.map((row) => ({
    eventName: row.event_name,
    paramKeys: row.param_keys || [],
    sampleCount: parseInt(row.total_occurrences, 10),
  }));
}

/**
 * Quick connectivity test — runs a cheap COUNT(*) on the most recent partition.
 */
export async function testBQAccess(bqProjectId, bqDataset, saJson) {
  try {
    const bq = bqClientFromSA(saJson);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const query = `
      SELECT COUNT(*) AS row_count
      FROM \`${bqProjectId}.${bqDataset}.events_${today}\`
      LIMIT 1
    `;

    await bq.query({ query, location: "US" });
    return { ok: true };
  } catch (err) {
    // If today's table doesn't exist, try yesterday
    if (err.message.includes("Not found")) {
      try {
        const bq = bqClientFromSA(saJson);
        const query = `
          SELECT COUNT(*) AS row_count
          FROM \`${bqProjectId}.${bqDataset}.events_*\`
          WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY))
          LIMIT 1
        `;
        await bq.query({ query, location: "US" });
        return { ok: true };
      } catch (e2) {
        return { ok: false, error: e2.message };
      }
    }
    return { ok: false, error: err.message };
  }
}
