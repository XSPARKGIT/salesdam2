import express from 'express';
import {
  listObjects,
  getObject,
  createObject,
  updateObject,
  deleteObject,
  renameObject,
} from '../controllers/objectController.js';
import {
  listFields,
  createField,
  updateField,
  deleteField,
  reorderFields,
  updateRelatedListColumns,
  renameField,
} from '../controllers/fieldController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { validate, schemas } from '../utils/validators.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Objects
router.get('/', listObjects);
router.get('/:apiName', getObject);
router.post(
  '/',
  checkAppPermission('canManageObjects'),
  validate(schemas.createObject),
  createObject,
);
router.put('/:apiName', checkAppPermission('canManageObjects'), updateObject);
router.delete(
  '/:apiName',
  checkAppPermission('canManageObjects'),
  deleteObject,
);
router.post(
  '/:apiName/rename',
  checkAppPermission('canManageObjects'),
  renameObject,
);

// Fields (nested under objects)
router.get('/:objectApiName/fields', listFields);
router.post(
  '/:objectApiName/fields',
  checkAppPermission('canManageObjects'),
  validate(schemas.createField),
  createField,
);
router.put(
  '/:objectApiName/fields/:fieldApiName',
  checkAppPermission('canManageObjects'),
  updateField,
);
router.delete(
  '/:objectApiName/fields/:fieldApiName',
  checkAppPermission('canManageObjects'),
  deleteField,
);
router.post(
  '/:objectApiName/fields/reorder',
  checkAppPermission('canManageObjects'),
  reorderFields,
);
router.put(
  '/:objectApiName/fields/:lookupFieldApiName/related-list-config',
  checkAppPermission('canManageObjects'),
  updateRelatedListColumns,
);
router.post(
  '/:objectApiName/fields/:fieldApiName/rename',
  checkAppPermission('canManageObjects'),
  renameField,
);

export default router;
