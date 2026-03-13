/**
 * ga4.js — Google Analytics Data API + Admin API integration
 *
 * All calls impersonate the client's service account. The SA must have:
 *   - roles/analytics.viewer on the GA4 property
 *
 * Key functions:
 *   getGA4Snapshot()    — last-30-day summary (sessions, events, top event names)
 *   getGA4PropertyMeta() — property display name, data streams, measurement IDs
 *   testGA4Access()     — quick connectivity check (returns true/false)
 */

import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

const GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

/**
 * Build a GoogleAuth client from a service account JSON string.
 */
function authFromSA(saJson) {
  return new GoogleAuth({
    credentials: JSON.parse(saJson),
    scopes: GA4_SCOPES,
  });
}

/**
 * Build a BetaAnalyticsDataClient authenticated with the client's SA.
 */
function dataClientFromSA(saJson) {
  const credentials = JSON.parse(saJson);
  return new BetaAnalyticsDataClient({ credentials });
}

/**
 * Fetch a 30-day GA4 snapshot for a property.
 *
 * Returns:
 * {
 *   sessions: number,
 *   totalUsers: number,
 *   eventCount: number,
 *   conversions: number,
 *   topEvents: [{ eventName, count }],   // top 20
 *   topConversions: [{ eventName, count }],
 *   dateRange: { startDate, endDate },
 * }
 */
export async function getGA4Snapshot(ga4PropertyId, saJson) {
  const client = dataClientFromSA(saJson);
  const property = `properties/${ga4PropertyId}`;

  const [response] = await client.runReport({
    property,
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    dimensions: [{ name: "eventName" }],
    metrics: [
      { name: "eventCount" },
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "conversions" },
    ],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 50,
  });

  // Aggregate top-level metrics and build event list
  let totalSessions = 0;
  let totalUsers = 0;
  let totalEventCount = 0;
  let totalConversions = 0;
  const topEvents = [];
  const topConversions = [];

  for (const row of response.rows || []) {
    const eventName = row.dimensionValues[0].value;
    const eventCount = parseInt(row.metricValues[0].value, 10) || 0;
    const sessions = parseInt(row.metricValues[1].value, 10) || 0;
    const users = parseInt(row.metricValues[2].value, 10) || 0;
    const conversions = parseInt(row.metricValues[3].value, 10) || 0;

    totalEventCount += eventCount;
    totalSessions = Math.max(totalSessions, sessions); // sessions is the same for all rows
    totalUsers = Math.max(totalUsers, users);
    totalConversions += conversions;

    if (topEvents.length < 20) {
      topEvents.push({ eventName, count: eventCount });
    }
    if (conversions > 0 && topConversions.length < 10) {
      topConversions.push({ eventName, count: conversions });
    }
  }

  // Fetch overall sessions/users from a separate totals report if rows were empty
  if (response.rows?.length === 0) {
    try {
      const [totals] = await client.runReport({
        property,
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "eventCount" },
        ],
      });
      totalSessions = parseInt(totals.rows?.[0]?.metricValues?.[0]?.value || "0", 10);
      totalUsers = parseInt(totals.rows?.[0]?.metricValues?.[1]?.value || "0", 10);
      totalEventCount = parseInt(totals.rows?.[0]?.metricValues?.[2]?.value || "0", 10);
    } catch { /* ignore */ }
  }

  return {
    sessions: totalSessions,
    totalUsers,
    eventCount: totalEventCount,
    conversions: totalConversions,
    topEvents,
    topConversions,
    dateRange: { startDate: "30daysAgo", endDate: "today" },
  };
}

/**
 * Fetch property metadata: display name, data streams, measurement IDs.
 *
 * Returns:
 * {
 *   displayName: string,
 *   propertyType: string,      // "PROPERTY_TYPE_ORDINARY" etc.
 *   industryCategory: string,
 *   timeZone: string,
 *   currencyCode: string,
 *   streams: [{ streamId, displayName, measurementId, webUri }],
 * }
 */
export async function getGA4PropertyMeta(ga4PropertyId, saJson) {
  const auth = authFromSA(saJson);
  const analyticsadmin = google.analyticsadmin({ version: "v1beta", auth });

  const propertyName = `properties/${ga4PropertyId}`;

  const [property, streamsRes] = await Promise.all([
    analyticsadmin.properties.get({ name: propertyName }),
    analyticsadmin.properties.dataStreams.list({ parent: propertyName }),
  ]);

  const streams = (streamsRes.data.dataStreams || []).map((s) => ({
    streamId: s.name?.split("/").pop(),
    displayName: s.displayName,
    measurementId: s.webStreamData?.measurementId || null,
    webUri: s.webStreamData?.defaultUri || null,
    type: s.type,
  }));

  return {
    displayName: property.data.displayName,
    propertyType: property.data.propertyType,
    industryCategory: property.data.industryCategory,
    timeZone: property.data.timeZone,
    currencyCode: property.data.currencyCode,
    streams,
  };
}

/**
 * Quick connectivity test — returns true if the SA can read the property,
 * false (with error message) if access is denied or property not found.
 */
export async function testGA4Access(ga4PropertyId, saJson) {
  try {
    const client = dataClientFromSA(saJson);
    // Minimal metadata call
    await client.getMetadata({ name: `properties/${ga4PropertyId}/metadata` });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
