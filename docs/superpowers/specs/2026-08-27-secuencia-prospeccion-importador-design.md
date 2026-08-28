# Conectar el importador con la secuencia de correos de GHL

**Fecha:** 2026-08-27
**Proyecto:** nlcn-panel (Next.js 16 + Supabase + GHL)
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Extiende:** [2026-08-03-import-retry-tray-design.md](2026-08-03-import-retry-tray-design.md)
· [2026-07-28-contact-importer-design.md](2026-07-28-contact-importer-design.md)

---

## 1. Qué es (en simple)

En GHL ya existe y está probada una secuencia de cuatro correos de prospección
que se dispara con la etiqueta `secuencia-prospeccion`. Hoy el importador **no
pone esa etiqueta**, así que el circuito está cortado: los contactos entran al
CRM y se quedan quietos.

Este cambio conecta las dos mitades, pero con dos candados, porque el error que
se quiere evitar es irreversible: mandarle un correo en frío —*"Hola, queremos
ver si le interesa lo que ofrecemos"*— a alguien con quien ya hay relación.

1. **Los contactos que ya existen no entran a la secuencia.** Hoy se actualizan
   en silencio y nadie se entera. Pasan a mostrarse en la bandeja de revisión
   para que el usuario decida.
2. **Los contactos sin correo tampoco entran.** No pueden recibir nada; entrar
   los dejaría marcados como "Contactado" sin haber sido contactados.

---

## 2. Lo que ya existe y NO se rehace

- **La secuencia en GHL** — 4 workflows construidos y probados el 2026-08-20.
  WF1 (secuencia), WF2 (respuesta recibida), WF3 (rebotes), WF4 (duplicados).
  "Stop on Response" verificado: al responder, la secuencia se detiene.
- **La bandeja de reintento** — filas editables con pista en español, acciones
  "Mantener correo" / "Mantener teléfono", botón Reintentar. Funciona.
- **`explainGhlError`** — traduce el rechazo por duplicado de GHL indicando el
  campo que colisionó.
- **`findExisting`** — busca por correo, luego teléfono + huella, luego huella.
- **`Contacto-Pendiente`** — etiqueta para filas sin correo ni teléfono. Esos
  contactos ya se importan hoy y así queda.

---

## 3. El problema concreto: los dos caminos del duplicado

Hoy un contacto repetido termina en uno de dos lugares, y solo uno es visible:

**Camino A — `findExisting` lo encuentra** (típicamente correo idéntico)
No intenta crear. Llama a `updateContact`, **sobrescribe los datos del cliente
con los del archivo**, lo cuenta como "actualizado" y le aplica las etiquetas.
No aparece en ninguna lista. El usuario nunca se entera. Es el caso más común.

**Camino B — `findExisting` falla pero GHL lo rechaza** (teléfono compartido de
agencia) → cae en `report.failed[]`, se ve en la bandeja, se puede corregir.

El Camino A es el peligroso: si le agregamos `secuencia-prospeccion` a la lista
de etiquetas sin más, **el contacto existente la recibe y entra al WF1**.

---

## 4. Alcance

**Incluye:**

1. `findExisting` encuentra un contacto → **no sobrescribir**. Esa fila va a un
   grupo nuevo del reporte con las diferencias campo por campo.
2. Ese grupo se muestra en la misma bandeja que ya existe, con tres acciones.
3. Regla de etiquetado: `secuencia-prospeccion` solo a filas con correo, sin
   conflicto, y cuando el usuario lo pidió explícitamente.
4. Casilla **"Iniciar la secuencia de correos con este lote"** en la pantalla de
   previsualización, **desmarcada por defecto**, con el conteo de cuántas filas
   entrarían.

**No incluye (YAGNI):**

- Detectar duplicados durante la previsualización (`dryRun`). Costaría una
  consulta a GHL por fila antes de saber si el usuario va a importar. La
  detección al importar ya cubre el caso y no escribe nada que no se pueda
  resolver desde la bandeja.
- Editar campos distintos a correo y teléfono (se mantiene del spec anterior).
- Persistir la sesión de importación en base de datos.
- Fusionar datos campo por campo entre el archivo y GHL.

---

## 5. Regla de etiquetado

| Fila | Etiquetas | Resultado |
|---|---|---|
| Correo + no existe + casilla marcada | archivo + lote + `secuencia-prospeccion` | Entra a la secuencia |
| Correo + no existe + casilla desmarcada | archivo + lote | Entra al CRM, sin correos |
| Ya existe (Camino A o B) | — | Va a la bandeja; no se escribe nada todavía |
| Ya existe + "Importar de todos modos" | archivo + lote + `duplicado-revisar` | Actualiza, cae en WF4, **sin correos** |
| Sin correo (solo teléfono, o vacía) | archivo + lote + `Contacto-Pendiente` | Entra al CRM, **nunca** a la secuencia |

La casilla desmarcada por defecto es deliberada. Olvidar marcarla no hace nada y
se corrige después; olvidar desmarcarla manda correos en frío que no se pueden
retirar. La falla debe caer del lado inofensivo.

---

## 6. Arquitectura

### 6.1 `lib/prospect-importer.ts`

`importProspects(mapped, options)` gana un parámetro:

```ts
type ImportOptions = {
  startSequence?: boolean;              // default false
  onDuplicate?: 'report' | 'update';    // default 'report'
};
```

- `onDuplicate: 'report'` (default): si `findExisting` devuelve un contacto, la
  fila **no se escribe**. Se acumula en `report.duplicates[]`.
- `onDuplicate: 'update'`: actualiza el contacto existente y le pone
  `duplicado-revisar` en lugar de la etiqueta de secuencia. Lo usa la acción
  "Importar de todos modos".
- `startSequence: true`: agrega `secuencia-prospeccion` **solo** a filas creadas
  nuevas y con `contact.email` no vacío.

Constantes nuevas y exportadas, para que no queden literales sueltos:
`SEQUENCE_TAG = 'secuencia-prospeccion'`, `DUPLICATE_TAG = 'duplicado-revisar'`.

### 6.2 Tipo nuevo en el reporte

```ts
type DuplicateRow = {
  rowNumber: number;
  name: string;
  company: string;
  matchedBy: 'email' | 'phone' | 'fingerprint';
  existingId: string;
  incoming: Record<string, string>;   // lo que trae el archivo
  existing: Record<string, string>;   // lo que hay en GHL
  differingFields: string[];          // solo los que no coinciden
  raw: RawProspect;                   // para reintentar sin re-parsear
};
```

`ImportReport` gana `duplicates: DuplicateRow[]`. El contador `updated` deja de
incrementarse por el Camino A, porque ya no se actualiza nada sin permiso.

### 6.3 Rutas

- `app/api/contacts/import/route.ts` — pasa `startSequence` (viene del form) a
  `importProspects`.
- `app/api/contacts/import/retry/route.ts` — el cuerpo gana
  `mode?: 'normal' | 'forceUpdate'`. `forceUpdate` llama con
  `onDuplicate: 'update'`.

### 6.4 Interfaz — `components/ContactImport.tsx`

Sección nueva en los resultados, **arriba** de la bandeja de errores porque
requiere decisión: *"N contactos ya existen en la base"*. Cada tarjeta muestra
empresa, nombre, por qué campo coincidió, y una tabla chica de solo los campos
que difieren (archivo vs. GHL). Tres acciones:

1. **Corregir** — reutiliza los campos editables de correo/teléfono que ya
   existen, y el botón Reintentar (`mode: 'normal'`).
2. **Descartar** — quita la tarjeta. Puramente de cliente, no toca el servidor.
3. **Importar de todos modos** — `mode: 'forceUpdate'`.

---

## 7. Flujo completo

```
Sube archivo → previsualización (validaciones + resumen de Claude)
             → casilla "iniciar secuencia" [ ] con conteo
             → Importar
                  ├── nuevo + correo + casilla ✓ → secuencia-prospeccion → WF1
                  ├── nuevo + correo + casilla ✗ → solo entra al CRM
                  ├── nuevo sin correo          → Contacto-Pendiente
                  ├── ya existe                 → bandeja de revisión
                  └── rechazado por GHL         → bandeja de reintento (ya existe)
                            │
                            └── Corregir / Descartar / Importar de todos modos
                                                          └── duplicado-revisar → WF4
```

---

## 8. Manejo de errores

- Si `findExisting` falla por red o límite de tasa, la fila **no se importa**:
  se trata como error, no como "es nueva". Crear a ciegas ante un fallo de
  búsqueda es justo el escenario que este diseño evita.
- Los `403` de GHL por límite de tasa son reales y frecuentes al recorrer
  muchos contactos: mantener `withRetry` con espera creciente.
- Si falla la creación de la oportunidad, el contacto ya creado **no** se
  revierte; se reporta la fila con su pista. Comportamiento actual, se mantiene.

---

## 9. Pruebas

Unitarias en `lib/prospect-importer.test.ts` (ya existe):

- Fila nueva con correo + `startSequence: true` → lleva `secuencia-prospeccion`.
- Fila nueva con correo + `startSequence: false` → no la lleva.
- Fila **sin correo** + `startSequence: true` → **no** la lleva, lleva
  `Contacto-Pendiente`.
- Fila existente + `onDuplicate: 'report'` → cae en `duplicates[]`, **no se
  llama a `updateContact`**, y `differingFields` lista solo lo que difiere.
- Fila existente + `onDuplicate: 'update'` → lleva `duplicado-revisar` y **no**
  `secuencia-prospeccion`.
- `findExisting` lanza excepción → la fila cae en `failed[]`, no en `created`.

Manual, antes de producción: importar un archivo de dos filas —una nueva con
correo, una que ya exista— con la casilla marcada, y verificar en GHL que solo
la primera recibe correo.

---

## 10. Dependencias externas

Estas viven en GHL, no en el código, y **el sistema no funciona sin ellas**:

- Los Waits del WF1 deben estar en **7 / 7 / 7 / 3 días**. Se bajaron a 2
  minutos para las pruebas del 2026-08-20.
- El correo 1 tenía un `test` pegado al inicio del cuerpo y un nombre propio que
  el cliente pidió quitar. El correo 2 tenía la firma duplicada.
- Remitente: `info@marketing.canonegrocostarica.com`.
- Los prospectos son canadienses: CASL exige identificación del remitente y
  enlace de baja funcional en los cuatro correos.
- `allowDuplicateContact` debe seguir en **false**. Es lo que hace que GHL
  rechace repetidos y que la bandeja de reintento tenga sentido.
