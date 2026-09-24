# Cognito Migration Plan

This is the plan for replacing the app's own email/password login and JWTs with Amazon Cognito. It was agreed on 2026-09-24. Item numbers refer to [MULTI_TENANT_GAPS.md](MULTI_TENANT_GAPS.md).

Cognito will be tested first in a personal AWS account, then moved to the company AWS account by changing settings, not code.

## Current auth, for reference

- [src/auth/](../src/auth/) handles register, login and refresh, with passwords hashed using scrypt.
- [src/plugins/auth.ts](../src/plugins/auth.ts) signs JWTs with `JWT_SECRET`. Access tokens last 365 days.
- Refresh tokens are stored as hashes in `RefreshToken`, rotate on use, and last 30 days.
- The JWT payload is `{ sub, organizationId, email }`. Routes read `request.user.organizationId` directly.

## Which gaps Cognito fixes

| Item | Fixed by Cognito? | Plan |
|---|---|---|
| 1. A user with no org sees every org's data | No. It's the app's own filtering | Fix before Cognito (step 1) |
| 3. Parse and parse-status routes skip the org check | No | Fix before Cognito (step 1) |
| 4. `DocumentBatch` has no `organizationId` | No, it's a schema change | Fix before Cognito (step 1) |
| 2. Anyone can join any org | Mostly. Self-signup is turned off and users are invited with `AdminCreateUser` | Small patch before Cognito (step 1). No custom invite flow |
| 5. The org is baked into a 365-day token that can't be revoked | Yes. Access tokens last 1 hour and can be revoked | Wait for Cognito. At most, shorten `expiresIn` in the meantime |
| 6. There are no roles | Partly. Cognito groups can carry roles, but the app still checks permissions | Step 4 |
| 34. No API keys for operators' systems | Yes, through the machine-to-machine login (client credentials flow) | Step 5 |

## Design decisions

1. **Scope tenants in one place.** The auth plugin sets `request.tenant = { userId, organizationId, roles }`, and every service scopes queries through one shared helper instead of reading `request.user.organizationId` itself. Switching to Cognito then only changes [src/plugins/auth.ts](../src/plugins/auth.ts).
2. **Store the Cognito `sub` in its own column, and never use it as `User.id`.** Add a unique, nullable `User.cognitoSub`. Every user gets a new `sub` when the pool is recreated in the company account. Foreign keys that point at a user (reports, documents, SME instructions, conversations) must keep pointing at the app's own `User.id`. On login, look the user up by `cognitoSub`, fall back to email, and save the new `sub` when it changes.
3. **Keep org membership and roles in the database, not in Cognito custom attributes.** The database is the source of truth for tenant scoping. Moving a user between orgs or removing them then doesn't touch Cognito. Custom attributes also can't be changed once the pool is created (see "Settings that can't be changed later").
4. **Use Cognito groups only as a coarse role signal, if at all.** Fine-grained permission checks stay in the app. The chosen source of roles, the database or groups, must be the only one used.
5. **Turn off self-signup.** Users are created by an admin or invited (`AdminCreateUser`). This closes item 2.
6. **Check tokens with `aws-jwt-verify`.** It needs only the pool ID and client ID and downloads the public keys itself, so checking tokens needs no AWS credentials. Admin actions such as `AdminCreateUser` do need IAM credentials.
7. **Define the pool as code.** Create the user pool, app clients, groups and domain with CDK, Terraform or CloudFormation, not the console. Recreating the pool in the company account is then one deploy with identical settings.

## Settings

Only these change between the personal and company accounts:

| Variable | Description |
|---|---|
| `AUTH_PROVIDER` | `local` (current JWT auth) or `cognito`. Lets both run side by side until the switch |
| `COGNITO_REGION` | AWS region of the user pool |
| `COGNITO_USER_POOL_ID` | User pool ID |
| `COGNITO_CLIENT_ID` | App client for users logging in |
| `COGNITO_M2M_CLIENT_ID` | App client for operators' systems using the client credentials flow (step 5) |
| Hosted UI domain and callback URLs | Only if the hosted UI or OAuth redirects are used. These differ per account and per environment |

Once `cognito` is the only provider, remove `JWT_SECRET`.

## Settings that can't be changed later

These are fixed when the pool is created. Getting one wrong means recreating the pool.

- **Sign-in field:** email.
- **Required attributes:** email only.
- **Custom attributes:** none planned, per decision 3. Any custom attribute added can't be removed or renamed later.

## Rules for testing in a personal account

- **Fake data only.** Use dummy users and generated statements (the `bank-statement-generator` agent). Real players' documents must never go into a personal account.
- **Check costs.** Cognito has a free monthly allowance of active users, which is enough for testing. Machine-to-machine token requests are billed separately. Check current Cognito pricing before relying on either.

## Moving to the company account

A user pool can't be copied between AWS accounts, and Cognito never exports password hashes.

1. Deploy the same pool-as-code (decision 7) to the company account.
2. Update the settings above.
3. Move users:
   - **Test users:** recreate them.
   - **Real users:** either re-invite them, which forces a password reset, or add a "migrate user" Lambda trigger that checks each user's old password once at their first login.
4. On each user's first login in the new pool, the app finds them by email and saves their new `cognitoSub` (decision 2). No other data changes.

## Steps

- [ ] **Step 1: tenant scoping, before Cognito.** Fix items 1, 3 and 4. Add `request.tenant` and the shared scoping helper (decision 1). Patch item 2: stop accepting `organizationId` on `/auth/register`, and make `GET /organizations` return only the caller's own org.
- [ ] **Step 2: schema.** Add `User.cognitoSub` (unique, nullable) and run a migration.
- [ ] **Step 3: Cognito auth plugin.** Create the pool as code in the personal account. Write the Cognito version of [src/plugins/auth.ts](../src/plugins/auth.ts): check the token with `aws-jwt-verify`, find the `User` by `cognitoSub` or email, and fill in `request.tenant`. Choose the version with `AUTH_PROVIDER`. Keep the local auth routes working while `AUTH_PROVIDER=local`.
- [ ] **Step 4: roles (item 6).** Define roles, at least admin, SME or compliance, and read-only or API. Add permission checks, starting with creating, activating and deleting SME instructions.
- [ ] **Step 5: machine-to-machine login (item 34).** Add an app client for the client credentials flow and custom scopes. Map each operator's client ID to an organization, then test with the Postman collection.
- [ ] **Step 6: switch.** Deploy to the company account, move users, set `AUTH_PROVIDER=cognito`, then remove [src/auth/](../src/auth/) login, register and refresh, the `RefreshToken` model, and `JWT_SECRET`.
