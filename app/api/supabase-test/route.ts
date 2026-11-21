
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();

    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        {
          connected: false,
          message: "No se pudo consultar la tabla products",
          code: error.code,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      connected: true,
      database: "Shifu Store",
      visibleProducts: count ?? 0,
      message: "Conexión exitosa con Supabase",
    });
  } catch {
    return NextResponse.json(
      {
        connected: false,
        message: "Revisa las variables de entorno y la configuración de Supabase",
      },
      { status: 500 }
    );
  }
}
