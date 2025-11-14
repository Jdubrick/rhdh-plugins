# Permissions Setup Guide

This guide explains how to configure group-based permissions for the Software Catalog MCP Tool with Keycloak.

## Overview

The plugin provides two permissions:

- **`catalog.mcp.fetch`** - Read access to catalog entities (action: `read`)
- **`catalog.mcp.delete`** - Delete access to catalog entities (action: `delete`)

## Quick Setup

### Prerequisites

Your Backstage instance must have:

1. ✅ Keycloak configured as an OIDC provider in `auth.providers.oidc`
2. ✅ Keycloak Organization provider (`keycloakOrg`) enabled in `catalog.providers`
3. ✅ Permission framework enabled: `permission.enabled: true`
4. ✅ Groups created in Keycloak: `read` and `write`

### Step 1: Create Permission Policy

Copy the example permission policy:

```bash
cp packages/backend/src/plugins/permissions.example.ts \
   packages/backend/src/plugins/permissions.ts
```

Or create it manually at `packages/backend/src/plugins/permissions.ts`:

```typescript
import { createBackendModule } from '@backstage/backend-plugin-api';
import { BackstageIdentityResponse } from '@backstage/plugin-auth-node';
import {
  AuthorizeResult,
  isPermission,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
} from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';

import {
  catalogMcpFetchPermission,
  catalogMcpDeletePermission,
} from '@red-hat-developer-hub/backstage-plugin-software-catalog-mcp-tool';

class CatalogMcpPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: BackstageIdentityResponse,
  ): Promise<PolicyDecision> {
    // Allow fetch for all authenticated users
    if (isPermission(request.permission, catalogMcpFetchPermission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow delete only for 'write' group members
    if (isPermission(request.permission, catalogMcpDeletePermission)) {
      if (!user) {
        return { result: AuthorizeResult.DENY };
      }

      const userGroups = user.identity.ownershipEntityRefs || [];
      const isInWriteGroup = userGroups.some(
        ref => ref === 'group:default/write' || ref.endsWith('/write'),
      );

      return {
        result: isInWriteGroup ? AuthorizeResult.ALLOW : AuthorizeResult.DENY,
      };
    }

    return { result: AuthorizeResult.ALLOW };
  }
}

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'catalog-mcp-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new CatalogMcpPermissionPolicy());
      },
    });
  },
});
```

### Step 2: Register Permission Policy

Update `packages/backend/src/index.ts`:

```typescript
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// ... other plugins ...

// Add permission policy
backend.add(import('./plugins/permissions'));

backend.start();
```

### Step 3: Restart Backend

```bash
yarn workspace backend start
```

## Verification

### Check Keycloak Groups are Synced

1. Log into Backstage
2. Navigate to the Catalog
3. Search for "Group" entities
4. Verify `read` and `write` groups appear

### Check User Group Membership

1. Log in with a test user
2. Navigate to their user profile in the catalog
3. Check the "Member of" section
4. Verify group membership is shown (e.g., `group:default/write`)

### Test Permissions

**User in "read" group:**

- ✅ Can use `fetch-catalog-entities`
- ❌ Cannot use `delete-catalog-entity`

**User in "write" group:**

- ✅ Can use `fetch-catalog-entities`
- ✅ Can use `delete-catalog-entity`

## What Changes Were Made

The following changes enable group-based permissions:

### 1. Plugin Changes

- Added `catalogMcpFetchPermission` permission definition
- Added `catalogMcpDeletePermission` permission definition
- Integrated permission checks in both MCP actions
- Added `@backstage/plugin-permission-common` dependency

### 2. Backend Configuration Required

- **Permission policy module** must be created and registered
- The policy checks user's `ownershipEntityRefs` for group membership

### 3. Backstage Configuration Required

All configuration is in `app-config.yaml`:

```yaml
# 1. Enable permissions
permission:
  enabled: true

# 2. Keycloak as identity provider
auth:
  providers:
    oidc:
      development:
        clientId: 'backstage'
        clientSecret: '${KEYCLOAK_CLIENT_SECRET}'
        metadataUrl: '${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration'
        signIn:
          resolvers:
            - resolver: emailLocalPartMatchingUserEntityName

# 3. Keycloak organization provider (syncs groups)
catalog:
  providers:
    keycloakOrg:
      default:
        baseUrl: '${KEYCLOAK_URL}'
        realm: '${REALM}'
        clientId: 'backstage'
        clientSecret: '${KEYCLOAK_CLIENT_SECRET}'
        schedule:
          frequency:
            minutes: 1
```

## How It Works

1. **Authentication**: User authenticates via Keycloak OIDC
2. **Group Sync**: `keycloakOrg` provider syncs Keycloak groups to Backstage catalog
3. **Identity Resolution**: User's identity includes their group memberships in `ownershipEntityRefs`
4. **Permission Check**: When a user invokes an MCP action:
   - The action extracts user `credentials`
   - Calls `permissions.authorize()` with the relevant permission
   - The permission policy checks if the user is in the required group
   - Returns `ALLOW` or `DENY` based on group membership

## Group Name Formats

Keycloak groups are imported with this format:

- `group:default/read` - for "read" group in "default" namespace
- `group:default/write` - for "write" group in "default" namespace

The permission policy checks for:

```typescript
ref === 'group:default/write' || ref.endsWith('/write');
```

This allows flexibility if your groups use different namespaces.

## Troubleshooting

### Groups not syncing from Keycloak

- Check `keycloakOrg` provider configuration
- Verify Keycloak client permissions include reading groups
- Check backend logs for sync errors
- Wait for the scheduled sync (default: 1 minute)

### Permission denied errors

- Verify user is member of the correct group in Keycloak
- Check user's entity in Backstage catalog shows group membership
- Verify permission policy is registered in backend
- Check backend logs for permission evaluation details

### Changes not taking effect

- Restart the backend after permission policy changes
- Clear browser cache/cookies
- Re-authenticate to get fresh user identity
