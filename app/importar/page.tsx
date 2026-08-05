import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ContactImport } from '@/components/ContactImport';

export const dynamic = 'force-dynamic';

export default function ImportarPage() {
  return (
    <div className="relative z-[2] max-w-[900px] mx-auto px-5 sm:px-9 pt-7 pb-20">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[13px] text-[--color-cream-dim] hover:text-[--color-cream] transition"
      >
        <ArrowLeft size={15} /> Volver al panel
      </Link>
      <h1 className="mt-6 mb-2 text-[32px] font-light tracking-[-0.02em] text-[--color-cream]">
        Importar contactos
      </h1>
      <p className="mb-8 text-[14px] text-[--color-cream-mute] max-w-[560px] leading-[1.6]">
        Subí el archivo de prospectos (CSV o Excel). Verás un resumen y confirmás antes de crear en
        Bralto. Los que reboten podés corregirlos y reintentar aquí mismo.
      </p>
      <ContactImport />
    </div>
  );
}
