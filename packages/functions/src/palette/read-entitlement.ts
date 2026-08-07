// Entitlement read for UI gating. Read-only on the money table (app_user has
// SELECT only — no write path exists here). An ABSENT money row means "not
// entitled": return the default { entitlement_active: false, expires_at: null }
// with 200, never a 404 — the UI gate treats absent-as-not-entitled.
import { makeSubscriptionsRepo } from '@closet/db';
import { EntitlementResponse, parseBoundary } from '@closet/shared';
import type { AuthedHandler } from '../auth/withAuth.js';
import { jsonResponse, errorFromThrown } from '../auth/respond.js';

export const readEntitlement: AuthedHandler = async (_req, { userId, exec }) => {
  try {
    const entitlement = await makeSubscriptionsRepo(exec).getEntitlement(userId);
    return jsonResponse(200, parseBoundary(EntitlementResponse, entitlement, 'palette.entitlement.result'));
  } catch (thrown) {
    return errorFromThrown(thrown);
  }
};
