# Security Spec for Shelf Control

## Data Invariants
- A grocery item must belong to a specific user (`userId`).
- Quantities (`inventoryQuantity`, `shoppingQuantity`) must be numbers.
- `name`, `category`, and `unit` must be non-empty strings within reasonable size limits.
- `userId` must match the authenticated user's ID.
- `createdAt` is immutable after creation.
- `updatedAt` must be set to the server time on every update.

## The Dirty Dozen Payloads
1. **Identity Spoofing**: Create an item with another user's `userId`.
2. **Identity Spoofing (Update)**: Update an item to change its `userId` to someone else.
3. **Privilege Escalation**: Read another user's items.
4. **Data Corruption**: Set `inventoryQuantity` to a string.
5. **Data Corruption**: Set `name` to a 2MB string.
6. **Integrity Bypass**: Create an item without a `name`.
7. **Temporal Bypass**: Create an item with a future `createdAt` timestamp.
8. **Temporal Bypass**: Update an item without updating `updatedAt`.
9. **Immutability Bypass**: Update the `createdAt` field.
10. **Shadow Fields**: Add an `isAdmin: true` field to a grocery item.
11. **ID Poisoning**: Use a 2KB string as a document ID.
12. **Unauthorized Deletion**: Delete someone else's item.

## Test Cases
The `firestore.rules.test.ts` (if implemented) would verify these are all `PERMISSION_DENIED`.
