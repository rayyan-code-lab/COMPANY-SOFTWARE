import { createPermissions } from '@/services/permissions';

export const PROFILES = {
  Admin_c: {
    label: 'Administrator',
    isDefault: false,
    isPublic: false,
    canManageTeam: true,
    reportsTo: null,
  },
  Manager_c: {
    label: 'Manager',
    isDefault: true,
    isPublic: false,
    canManageTeam: false,
    reportsTo: 'Admin_c',
  },
};

const PURCHASE_READ_ONLY_FIELDS = [
  'purchaseRef_c',
  'stockItem_c',
  'quantityKg_c',
  'pricePerKg_c',
  'totalPurchaseValue_c',
  'purchaseDate_c',
  'supplierName_c',
  'notes_c',
  'advanceAmount_c',
  'advanceDate_c',
  'advanceMethod_c',
  'cashAtPurchase_c',
  'onlineAtPurchase_c',
  'recordStatus_c',
  'revision_c',
  'idempotencyKey_c',
  'cancellationReason_c',
  'cancelledAt_c',
];

const TABLE_PERMISSIONS = {
  Admin_c: {
    stock_movements_c: { access: 'Full' },
    workers_c: { access: 'Full' },
    attendance_c: { access: 'Full' },
    payroll_c: { access: 'Full' },
    transactions_c: { access: 'Full' },
    sales_c: { access: 'Full' },
    expenses_c: { access: 'Full' },
    stock_items_c: { access: 'Full' },
    purchases_c: { access: 'Full' },
    purchase_payments_c: { access: 'Full' },
    purchase_audit_c: { access: 'Full' },
    worker_payments_c: { access: 'Full' },
  },
  Manager_c: {
    stock_movements_c: { access: 'Read,Create,Update' },
    workers_c: { access: 'Read,Create,Update' },
    attendance_c: { access: 'Read,Create,Update' },
    payroll_c: { access: 'Read' },
    transactions_c: { access: 'Read,Create,Update' },
    sales_c: { access: 'Read,Create,Update' },
    expenses_c: { access: 'Read,Create,Update' },
    stock_items_c: { access: 'Read,Create' },
    purchases_c: {
      access: 'Read,Create,Update',
      readOnlyFields: PURCHASE_READ_ONLY_FIELDS,
    },
    purchase_payments_c: { access: 'Read,Create' },
    purchase_audit_c: { access: 'Read,Create' },
    worker_payments_c: { access: 'Read,Create,Update' },
  },
};

export const { getProfileMeta, getTableAccess, getFieldAccess } = createPermissions(PROFILES, TABLE_PERMISSIONS);
