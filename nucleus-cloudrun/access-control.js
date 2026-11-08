import { createHash, timingSafeEqual } from 'node:crypto';

// Missing configuration must never turn a private service into a public one.
export function createPinGuard(accessPin) {
  const configured = typeof accessPin === 'string' && accessPin.trim().length > 0;
  const expected = createHash('sha256').update(configured ? accessPin : '').digest();
  return (req, res, next) => {
    if (!configured) return res.status(503).json({
      error: 'Soukromý přístup není nakonfigurovaný. Správce musí nastavit přístupový PIN.',
      code: 'ACCESS_NOT_CONFIGURED'
    });
    const provided = createHash('sha256').update(String(req.get('x-nucleus-pin') || '')).digest();
    if (!timingSafeEqual(provided, expected)) return res.status(401).json({
      error: 'Nucleus je uzamčen. Zadej přístupový PIN.', code: 'PIN_REQUIRED'
    });
    next();
  };
}
