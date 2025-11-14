# Software Catalog MCP Tool

A Backstage MCP (Model Context Protocol) tool plugin that provides AI assistants with the ability to interact with the Backstage Software Catalog. This plugin exposes catalog operations as MCP tools that can be used by AI assistants like Claude, ChatGPT, or other MCP-compatible clients.

## Features

- **Fetch Catalog Entities**: Search and retrieve catalog entities with flexible filtering
- **Delete Catalog Entities**: Remove entities from the catalog (with permission controls)
- **Permission Framework Integration**: Role-based access control for all operations
- **Group-based Permissions**: Support for Keycloak groups and other identity providers

## Available MCP Tools

### 1. `fetch-catalog-entities`

Search and retrieve catalog entities from the Backstage server.

**Permissions Required**: `catalog.mcp.fetch` (read permission)

**Parameters**:

- `kind` (optional): Filter by entity kind (Component, API, System, etc.)
- `type` (optional): Filter by entity type (requires `kind` to be specified)
- `name` (optional): Filter by entity name
- `owner` (optional): Filter by owner
- `lifecycle` (optional): Filter by lifecycle
- `tags` (optional): Filter by tags (comma-separated)
- `verbose` (optional): Return full entity objects (default: false)

### 2. `delete-catalog-entity`

Delete a catalog entity by its entity reference.

**Permissions Required**: `catalog.mcp.delete` (delete permission)

**Parameters**:

- `entityRef` (required): The entity reference in format `[kind]:[namespace]/[name]`

## Installation

1. Install the plugin package:

```bash
yarn --cwd packages/backend add @red-hat-developer-hub/backstage-plugin-software-catalog-mcp-tool
```

2. Add the plugin to your backend in `packages/backend/src/index.ts`:

```ts
const backend = createBackend();
// ...
backend.add(
  import('@red-hat-developer-hub/backstage-plugin-software-catalog-mcp-tool'),
);
```

3. Enable the plugin in your `app-config.yaml`:

```yaml
backend:
  actions:
    pluginSources:
      - 'software-catalog-mcp-tool'
```

## Permission Configuration

This plugin integrates with Backstage's permission framework and provides two permissions:

- `catalog.mcp.fetch`: Permission to read/fetch catalog entities (action: `read`)
- `catalog.mcp.delete`: Permission to delete catalog entities (action: `delete`)

### Setting Up Group-Based Permissions with Keycloak

To configure permissions so that:

- **Any authenticated user** can use `fetch-catalog-entities`
- **Only users in the "write" group** can use `delete-catalog-entity`

#### Step 1: Ensure Keycloak Integration is Configured

Make sure your `app-config.yaml` has Keycloak configured as an identity provider and catalog provider:

```yaml
auth:
  environment: development
  providers:
    oidc:
      development:
        clientId: 'backstage'
        clientSecret: '${KEYCLOAK_CLIENT_SECRET}'
        metadataUrl: '${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration'
        callbackUrl: '${BASE_URL}/api/auth/oidc/handler/frame'
        signIn:
          resolvers:
            - resolver: emailLocalPartMatchingUserEntityName

catalog:
  providers:
    keycloakOrg:
      default:
        baseUrl: '${KEYCLOAK_BASE_URL}'
        loginRealm: '${KEYCLOAK_REALM}'
        realm: '${KEYCLOAK_REALM}'
        clientId: 'backstage'
        clientSecret: '${KEYCLOAK_CLIENT_SECRET}'
        schedule:
          frequency:
            minutes: 1
          initialDelay:
            seconds: 15

permission:
  enabled: true
```

#### Step 2: Create a Permission Policy

Create a custom permission policy module in your backend. Create a file at `packages/backend/src/plugins/permissions.ts`:

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
    // Allow fetch permission for all authenticated users
    if (isPermission(request.permission, catalogMcpFetchPermission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow delete permission only for users in the 'write' group
    if (isPermission(request.permission, catalogMcpDeletePermission)) {
      if (!user) {
        return { result: AuthorizeResult.DENY };
      }

      // Check if user is in the 'write' group
      const userGroups = user.identity.ownershipEntityRefs || [];
      const isInWriteGroup = userGroups.some(
        ref => ref === 'group:default/write' || ref.endsWith('/write'),
      );

      return {
        result: isInWriteGroup ? AuthorizeResult.ALLOW : AuthorizeResult.DENY,
      };
    }

    // Default: allow other permissions
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

#### Step 3: Register the Permission Policy

Add the permission policy module to your backend in `packages/backend/src/index.ts`:

```typescript
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// ... other plugins ...

// Add the permission policy
backend.add(import('./plugins/permissions'));

backend.start();
```

### Verifying Group Membership

Your Keycloak groups will be imported into Backstage as Group entities. Users will have their group memberships reflected in their `ownershipEntityRefs`. The format is typically:

- `group:default/read` - for the "read" group
- `group:default/write` - for the "write" group

You can verify this by:

1. Logging into Backstage with a user from Keycloak
2. Checking the user's profile in the catalog
3. Looking at the "Member of" section to see their groups

### Alternative: RBAC Plugin

If you're using Red Hat Developer Hub or have the RBAC plugin installed, you can also configure permissions using RBAC policies:

**Example `rbac-policy.csv`**:

```csv
# Allow all authenticated users to fetch catalog entities
p, role:default/catalog-reader, catalog.mcp.fetch, use, allow

# Allow only write group to delete catalog entities
p, role:default/catalog-writer, catalog.mcp.delete, use, allow

# Assign catalog-reader to all users
g, user:default/*, role:default/catalog-reader

# Assign catalog-writer to write group members
g, group:default/write, role:default/catalog-writer
```

## What Changes are Needed in Backstage

To properly recognize Keycloak groups for permissions, ensure the following:

1. **Identity Provider Integration**:

   - Keycloak OIDC provider must be configured in `auth.providers.oidc`
   - Sign-in resolver must be configured to map Keycloak users to Backstage users

2. **Catalog Provider Integration**:

   - Keycloak Organization provider (`keycloakOrg`) must be enabled in `catalog.providers`
   - This syncs Keycloak groups and users into the Backstage catalog

3. **Permission Framework**:

   - Permissions must be enabled: `permission.enabled: true`
   - A custom permission policy must be implemented to check group membership

4. **Backend Configuration**:
   - The permission policy module must be registered in the backend
   - The MCP tool plugin must be registered in the backend

All of these are configured via `app-config.yaml` and backend code changes as shown in the examples above.

## Development

This plugin can be started in standalone mode from directly in this package with `yarn start`. This is most convenient when developing the plugin itself.

To run the entire project including the frontend, run `yarn dev` from the root directory.

## Testing Permissions

To test that permissions are working correctly:

1. **Test with a user in the "read" group**:

   - Should be able to use `fetch-catalog-entities`
   - Should NOT be able to use `delete-catalog-entity`

2. **Test with a user in the "write" group**:

   - Should be able to use `fetch-catalog-entities`
   - Should be able to use `delete-catalog-entity`

3. **Check logs**: The plugin logs permission checks, so you can verify in the backend logs that permissions are being evaluated correctly.

## Troubleshooting

### "Permission denied" errors

- Verify that `permission.enabled: true` in your `app-config.yaml`
- Check that the permission policy is registered in your backend
- Verify that Keycloak groups are being synced to Backstage catalog
- Check user's `ownershipEntityRefs` to confirm group membership

### Groups not appearing in Backstage

- Verify `keycloakOrg` provider is configured correctly
- Check the schedule configuration - it may take time for first sync
- Look at backend logs for any errors from the Keycloak provider
- Verify the Keycloak client has permission to read groups

### MCP tools not appearing

- Verify the plugin is registered in `backend/src/index.ts`
- Check that `backend.actions.pluginSources` includes `'software-catalog-mcp-tool'`
- Restart the backend after making configuration changes
