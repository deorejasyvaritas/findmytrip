// Mientras se baja el archivo de una pantalla: un esqueleto liviano (sin textos que salten).
export default function PageSkeleton() {
  return (
    <div className="page-skeleton skeleton" aria-busy="true" aria-label="Cargando">
      <div className="sk" style={{ height: 28, width: "45%" }} />
      <div className="sk" style={{ height: 16, width: "70%" }} />
      <div className="sk" style={{ height: 160, borderRadius: 16 }} />
      <div className="sk" style={{ height: 96, borderRadius: 16 }} />
    </div>
  );
}
