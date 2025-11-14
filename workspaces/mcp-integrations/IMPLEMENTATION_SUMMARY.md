# Implementation Summary: Delete Action and Permissions

This document summarizes the changes made to add a delete action to the software-catalog-mcp-tool and implement group-based permissions.

## What Was Implemented

### 1. Delete Catalog Entity Action

Added a new MCP action `delete-catalog-entity` that:

- Accepts an `entityRef` parameter (format: `kind:namespace/name`)
- Requires authentication
- Checks the `catalog.mcp.delete` permission
- Uses the Backstage Catalog API to delete the entity
- Returns success/error status with descriptive messages

### 2. Permission Definitions

Created two permissions:

- **`catalogMcpFetchPermission`** - For reading catalog entities
  - Name: `catalog.mcp.fetch`
  - Action: `read`
- **`catalogMcpDeletePermission`** - For deleting catalog entities
  - Name: `catalog.mcp.delete`
  - Action: `delete`

### 3. Permission Checks

Integrated permission checks into both MCP actions:

- **`fetch-catalog-entities`**: Checks `catalogMcpFetchPermission`
  - Falls back to allowing if permissions not configured (backwards compatibility)
- **`delete-catalog-entity`**: Checks `catalogMcpDeletePermission`
  - Strictly requires authentication and permission
  - Returns descriptive error if permission denied

### 4. Documentation

Created comprehensive documentation:

- Updated `README.md` with full setup instructions
- Created `PERMISSIONS.md` with quick setup guide
- Created `permissions.example.ts` - ready-to-use permission policy

## Files Modified

### Plugin Files

```
plugins/software-catalog-mcp-tool/
├── src/
│   ├── plugin.ts          # Added delete action, permissions, and checks
│   ├── index.ts           # Exported permissions
├── package.json           # Added @backstage/plugin-permission-common
├── README.md              # Complete documentation
└── PERMISSIONS.md         # Quick setup guide
```

### Backend Files (for user to implement)

```
packages/backend/
└── src/
    └── plugins/
        └── permissions.example.ts  # Example permission policy
```

## Changes Required in Backstage

To enable group-based permissions, you need to:

### 1. Already Configured ✅

Based on your `app-config.yaml`, you already have:

- ✅ Keycloak OIDC authentication
- ✅ Keycloak Organization provider (syncing groups)
- ✅ Permission framework enabled

### 2. New Configuration Required

#### A. Create Permission Policy Module

Create `packages/backend/src/plugins/permissions.ts`:

```bash
cp packages/backend/src/plugins/permissions.example.ts \
   packages/backend/src/plugins/permissions.ts
```

#### B. Register Permission Policy

Add to `packages/backend/src/index.ts`:

```typescript
backend.add(import('./plugins/permissions'));
```

#### C. Install Dependencies (if needed)

The permission policy requires:

```bash
yarn workspace backend add @backstage/plugin-auth-node
yarn workspace backend add @backstage/plugin-permission-node
```

## How Permissions Work

### Permission Flow

```
User → MCP Client → MCP Server → MCP Action
                                    ↓
                              Check Credentials
                                    ↓
                          Call permissions.authorize()
                                    ↓
                          Permission Policy Evaluates:
                          - Is user authenticated?
                          - Which groups is user in?
                          - Does group have permission?
                                    ↓
                          Return ALLOW or DENY
                                    ↓
                          Execute or Reject Action
```

### Group Checking Logic

The permission policy checks user's `ownershipEntityRefs`:

```typescript
const userGroups = user.identity.ownershipEntityRefs || [];
const isInWriteGroup = userGroups.some(
  ref => ref === 'group:default/write' || ref.endsWith('/write'),
);
```

Groups synced from Keycloak will appear as:

- `group:default/read`
- `group:default/write`

## Testing the Implementation

### 1. Verify Plugin is Working

```bash
# Start the backend
yarn workspace backend start

# Check logs for:
# - "Registered action: fetch-catalog-entities"
# - "Registered action: delete-catalog-entity"
```

### 2. Test with MCP Client

Use an MCP client (like Claude Desktop) to:

- Call `fetch-catalog-entities` - should work for all users
- Call `delete-catalog-entity` - should only work for "write" group

### 3. Check Logs

The plugin logs permission checks:

```
fetch-catalog-entities: Fetching catalog entities with options: {...}
delete-catalog-entity: Attempting to delete entity: Component:default/test
```

## Expected Behavior

### User in "read" group only:

- ✅ Can fetch catalog entities
- ❌ Cannot delete catalog entities (gets permission denied error)

### User in "write" group:

- ✅ Can fetch catalog entities
- ✅ Can delete catalog entities

### Unauthenticated user:

- ❌ Cannot use either action (authentication required)

## Next Steps

1. **Copy the permission policy**:

   ```bash
   cp packages/backend/src/plugins/permissions.example.ts \
      packages/backend/src/plugins/permissions.ts
   ```

2. **Register it in backend**:
   Edit `packages/backend/src/index.ts` and add:

   ```typescript
   backend.add(import('./plugins/permissions'));
   ```

3. **Restart the backend**:

   ```bash
   yarn workspace backend start
   ```

4. **Test with different users**:

   - Log in as a user in the "read" group
   - Try both fetch and delete actions
   - Log in as a user in the "write" group
   - Verify delete works

5. **Check the logs** to see permission checks in action

## Troubleshooting

### Groups not showing in Backstage

- Wait for Keycloak sync (default: 1 minute interval)
- Check backend logs for sync errors
- Verify Keycloak client has "view-groups" role

### Permission denied unexpectedly

- Check user's group membership in Backstage catalog
- Verify `ownershipEntityRefs` includes the correct group
- Check permission policy is registered
- Review backend logs for permission evaluation

### Delete not working

- Verify entity reference format: `kind:namespace/name`
- Check backend logs for specific error messages
- Ensure user is authenticated
- Confirm user is in "write" group

## Files for Reference

All documentation is in the plugin directory:

- `README.md` - Complete guide with all details
- `PERMISSIONS.md` - Quick setup steps
- `permissions.example.ts` - Ready-to-use permission policy

## Summary

✅ Delete action implemented
✅ Permissions defined  
✅ Permission checks integrated
✅ Documentation created
✅ Example code provided

**Your Keycloak setup is already configured correctly!** You just need to:

1. Copy the permission policy file
2. Register it in your backend
3. Restart and test

The implementation follows Backstage best practices and integrates seamlessly with your existing Keycloak configuration.
