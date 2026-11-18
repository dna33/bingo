const roles = {
  administrator: ['editions:read', 'editions:configure', 'participants:read', 'contacts:read', 'imports:read', 'imports:write', 'cards:issue', 'deliveries:read', 'deliveries:manage', 'game:operate', 'results:confirm', 'exports:read', 'audit:read', 'legacy:manage'],
  operator: ['deliveries:read', 'editions:read', 'participants:read', 'contacts:read', 'game:operate', 'results:confirm'],
  importer: ['editions:read', 'participants:read', 'contacts:read', 'imports:read', 'imports:write', 'cards:issue', 'deliveries:read', 'deliveries:manage'],
  viewer: ['editions:read', 'participants:read'],
  auditor: ['deliveries:read', 'imports:read', 'editions:read', 'participants:read', 'contacts:read', 'exports:read', 'audit:read']
};
function permissionsFor(staff) {
  return new Set((staff.roles || []).flatMap(role => roles[role] || []));
}
module.exports = { roles, permissionsFor };
