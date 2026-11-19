const supabaseUrl = 'https://kseaqcwhsvenxtmpqjvu.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzZWFxY3doc3Zlbnh0bXBxanZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzA3NzYsImV4cCI6MjEwODM0Njc3Nn0.xb0jWWmc1AAplHZ_Whgy3d-OCvsQyKHR3W6zFpvcKvA'; 
const clienteSupabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// === PROTECCIÓN DE RUTA ===
async function verificarAcceso() {
    const { data: { session }, error } = await clienteSupabase.auth.getSession();
    if (!session || error) {
        window.location.href = 'index.html'; 
    }
}
verificarAcceso();

// === CERRAR SESIÓN ===
async function cerrarSesion() {
    await clienteSupabase.auth.signOut();
    window.location.href = 'index.html';
}

let registrosGlobales = [];
let datosFiltrados = [];          // Resultado vigente (con o sin filtros)
let paginaActual = 1;
const REGISTROS_POR_PAGINA = 10;

// Descargas simultáneas máximas al armar ZIP (evita ERR_INSUFFICIENT_RESOURCES)
const CONCURRENCIA_FOTOS = 4;

// === UTILIDADES ===

// Fecha en hora de Lima (UTC-5). Si la BD entrega la fecha sin zona horaria, se asume UTC.
function formatearFechaLima(valor) {
    if (!valor) return '';
    let texto = String(valor).trim().replace(' ', 'T');
    if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(texto)) texto += 'Z';
    const fecha = new Date(texto);
    if (isNaN(fecha)) return String(valor);
    return fecha.toLocaleString('es-PE', { timeZone: 'America/Lima' });
}

// Evita que texto de la BD se interprete como HTML
function escaparHTML(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escapa comillas y saltos de línea para CSV
function escaparCSV(valor) {
    if (valor === null || valor === undefined) return '""';
    const limpio = String(valor).replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return `"${limpio}"`;
}

// Descarga un Blob como archivo
function descargarBlob(blob, nombreArchivo) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

// Extensión segura de una URL de foto
function extensionDeUrl(url) {
    const ext = url.split('?')[0].split('.').pop();
    return (ext && ext.length <= 5) ? ext : 'jpg';
}

// Ejecuta tareas asíncronas con un máximo de "limite" en paralelo
async function ejecutarConLimite(tareas, limite, alProgresar) {
    let siguiente = 0;
    let completadas = 0;
    const trabajadores = Array.from({ length: limite }, async () => {
        while (siguiente < tareas.length) {
            const mi = siguiente++;
            await tareas[mi]();
            completadas++;
            if (alProgresar) alProgresar(completadas, tareas.length);
        }
    });
    await Promise.all(trabajadores);
}

// Obtiene la foto: primero fetch normal; si falla, vía Storage de Supabase (usa tu sesión)
async function obtenerBlobFoto(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (blob.size === 0) throw new Error('Archivo vacío');
        return blob;
    } catch (errFetch) {
        // Formato: .../storage/v1/object/(public|sign|authenticated)/<bucket>/<ruta>
        const m = url.split('?')[0].match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
        if (!m) throw errFetch;
        const bucket = m[1];
        const ruta = decodeURIComponent(m[2]);
        const { data, error } = await clienteSupabase.storage.from(bucket).download(ruta);
        if (error) throw error;
        return data;
    }
}

// === CARGAR TODOS LOS REGISTROS (Supabase devuelve máx. 1000 por consulta) ===
async function obtenerTodosLosRegistros() {
    const paso = 1000;
    let desde = 0;
    const todos = [];

    while (true) {
        const { data, error } = await clienteSupabase
            .from('registros_catastro')
            .select('*')
            .order('creado_en', { ascending: false })
            .range(desde, desde + paso - 1);

        if (error) throw error;
        todos.push(...data);
        if (data.length < paso) break;
        desde += paso;
    }
    return todos;
}

// === CARGAR Y UNIR DATOS ===
async function cargarRegistros() {
    let registros;
    try {
        registros = await obtenerTodosLosRegistros();
    } catch (errorRegistros) {
        console.error('Error al cargar registros:', errorRegistros);
        return;
    }

    const suministrosUnicos = [...new Set(registros.map(r => r.suministro))].filter(Boolean);
    const mapaSuministros = new Map();

    // Pedimos la data a Supabase en bloques de 100 para no saturar la petición
    for (let i = 0; i < suministrosUnicos.length; i += 100) {
        const bloque = suministrosUnicos.slice(i, i + 100);

        const { data: bloqueDatos, error: errorSuministros } = await clienteSupabase
            .from('suministros')
            .select('suministro, medidor_actual, distrito, direccion, anio_fabricacion, numero_medidor, marca')
            .in('suministro', bloque);

        if (errorSuministros) {
            console.error('Error cargando bloque de suministros:', errorSuministros);
        } else if (bloqueDatos) {
            bloqueDatos.forEach(s => mapaSuministros.set(String(s.suministro), s));
        }
    }

    // Cruzamos la información
    registrosGlobales = registros.map(reg => ({
        ...reg,
        suministros: mapaSuministros.get(String(reg.suministro)) || {}
    }));

    renderizarTabla(registrosGlobales);
}

// === RENDER DE TABLA (CON PAGINACIÓN) ===
function renderizarTabla(datos, reiniciarPagina = true) {
    datosFiltrados = datos;
    if (reiniciarPagina) paginaActual = 1;

    const totalPaginas = Math.max(1, Math.ceil(datosFiltrados.length / REGISTROS_POR_PAGINA));
    if (paginaActual > totalPaginas) paginaActual = totalPaginas;

    const tbody = document.querySelector('#tablaRegistros tbody');
    tbody.innerHTML = '';

    if (datosFiltrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No se encontraron registros.</td></tr>';
        renderizarPaginador();
        return;
    }

    const inicio = (paginaActual - 1) * REGISTROS_POR_PAGINA;
    const pagina = datosFiltrados.slice(inicio, inicio + REGISTROS_POR_PAGINA);

    let html = '';
    pagina.forEach((reg, i) => {
        const index = inicio + i; // índice dentro de datosFiltrados
        const fecha = formatearFechaLima(reg.creado_en);
        const datosSum = reg.suministros || {};

        const medidorInfo = datosSum.distrito 
            ? `${escaparHTML(datosSum.medidor_actual || 'S/D')} <br><small>${escaparHTML(datosSum.distrito || 'S/D')}</small>` 
            : 'N/A';
            
        const submotivo = reg.submotivo_cod ? ` - ${escaparHTML(reg.submotivo_cod)}` : '';
        const itm = escaparHTML(reg.itm_portafusible || 'N/A');
        
        const tieneFotos = reg.fotos_urls && reg.fotos_urls.length > 0;
        const btnFotos = tieneFotos 
            ? `<div class="evidencia-acciones">
                   <button class="btn-fotos" onclick="abrirModal(${index})">Ver ${reg.fotos_urls.length} Fotos</button>
                   <button class="btn-descargar-fotos" title="Descargar fotos del suministro ${escaparHTML(reg.suministro)}" onclick="descargarFotosSuministro(${index}, this)">⬇ Descargar</button>
               </div>`
            : '<span style="color:#999; font-size:0.8rem;">Sin fotos</span>';

        html += `
            <tr>
                <td>${escaparHTML(fecha)}</td>
                <td><strong>${escaparHTML(reg.suministro)}</strong></td>
                <td>${medidorInfo}</td>
                <td>${escaparHTML(reg.tipo_caja)} / ${escaparHTML(reg.tipo_chapa)}</td>
                <td>${escaparHTML(reg.fase)} / ${escaparHTML(reg.tipo_acometida)}</td>
                <td>${itm}</td>
                <td><strong>${escaparHTML(reg.impedimento_cod)}</strong>${submotivo}</td>
                <td>${btnFotos}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    renderizarPaginador();
}

// === PAGINADOR ===
function obtenerContenedorPaginador() {
    let cont = document.getElementById('paginador');
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'paginador';
        cont.className = 'paginador';
        const tabla = document.getElementById('tablaRegistros');
        const wrapper = tabla.closest('.table-responsive') || tabla;
        wrapper.insertAdjacentElement('afterend', cont);
    }
    return cont;
}

function renderizarPaginador() {
    const cont = obtenerContenedorPaginador();
    const total = datosFiltrados.length;

    if (total === 0) {
        cont.innerHTML = '';
        return;
    }

    const totalPaginas = Math.ceil(total / REGISTROS_POR_PAGINA);
    const desde = (paginaActual - 1) * REGISTROS_POR_PAGINA + 1;
    const hasta = Math.min(paginaActual * REGISTROS_POR_PAGINA, total);

    // Ventana de hasta 5 números de página alrededor de la actual
    let ini = Math.max(1, paginaActual - 2);
    let fin = Math.min(totalPaginas, ini + 4);
    ini = Math.max(1, fin - 4);

    let botones = `<button class="pag-btn" ${paginaActual === 1 ? 'disabled' : ''} onclick="irAPagina(${paginaActual - 1})">‹ Anterior</button>`;
    if (ini > 1) {
        botones += `<button class="pag-btn" onclick="irAPagina(1)">1</button>`;
        if (ini > 2) botones += `<span class="pag-puntos">…</span>`;
    }
    for (let p = ini; p <= fin; p++) {
        botones += `<button class="pag-btn ${p === paginaActual ? 'activo' : ''}" onclick="irAPagina(${p})">${p}</button>`;
    }
    if (fin < totalPaginas) {
        if (fin < totalPaginas - 1) botones += `<span class="pag-puntos">…</span>`;
        botones += `<button class="pag-btn" onclick="irAPagina(${totalPaginas})">${totalPaginas}</button>`;
    }
    botones += `<button class="pag-btn" ${paginaActual === totalPaginas ? 'disabled' : ''} onclick="irAPagina(${paginaActual + 1})">Siguiente ›</button>`;

    cont.innerHTML = `
        <span class="pag-info">Mostrando ${desde}–${hasta} de ${total} registros</span>
        <div class="pag-controles">${botones}</div>
    `;
}

function irAPagina(n) {
    const totalPaginas = Math.max(1, Math.ceil(datosFiltrados.length / REGISTROS_POR_PAGINA));
    if (n < 1 || n > totalPaginas) return;
    paginaActual = n;
    renderizarTabla(datosFiltrados, false);
}

// === LÓGICA DE FILTROS ===
document.getElementById('btnFiltrar').addEventListener('click', () => {
    const sumFiltro = document.getElementById('filtroSuministro').value;
    const impFiltro = document.getElementById('filtroImpedimento').value;

    const filtrados = registrosGlobales.filter(reg => {
        const cumpleSum = sumFiltro === '' || String(reg.suministro).includes(sumFiltro);
        const cumpleImp = impFiltro === '' || reg.impedimento_cod === impFiltro;
        return cumpleSum && cumpleImp;
    });

    renderizarTabla(filtrados); // vuelve a la página 1
});

// === DESCARGAR FOTOS DE UN SOLO SUMINISTRO (ZIP) ===
async function descargarFotosSuministro(index, boton) {
    const reg = datosFiltrados[index];
    if (!reg || !reg.fotos_urls || reg.fotos_urls.length === 0) {
        return alert('Este registro no tiene fotos.');
    }

    const textoOriginal = boton.innerHTML;
    boton.innerHTML = '⏳ Generando...';
    boton.disabled = true;

    try {
        const zip = new JSZip();
        let exitosas = 0, fallidas = 0, primerError = null;

        const tareas = reg.fotos_urls.map((url, i) => async () => {
            try {
                const blob = await obtenerBlobFoto(url);
                // La ruta crea la carpeta solo si la foto se descargó
                zip.file(`${reg.suministro}/foto_${i + 1}.${extensionDeUrl(url)}`, blob);
                exitosas++;
            } catch (err) {
                fallidas++;
                if (!primerError) primerError = `${err.message || err}`;
                console.error(`Error foto ${i + 1} del suministro ${reg.suministro}:`, err);
            }
        });

        await ejecutarConLimite(tareas, CONCURRENCIA_FOTOS);

        if (exitosas === 0) {
            throw new Error(`No se pudo descargar ninguna foto. Primer error: ${primerError}`);
        }

        const contenidoZip = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        descargarBlob(contenidoZip, `Fotos_${reg.suministro}.zip`);

        if (fallidas > 0) alert(`Se omitieron ${fallidas} foto(s) que no se pudieron descargar.`);
    } catch (error) {
        console.error('Error generando ZIP del suministro:', error);
        alert('No se pudo generar el ZIP.\n' + (error.message || error));
    } finally {
        boton.innerHTML = textoOriginal;
        boton.disabled = false;
    }
}

// === EXPORTAR A CSV (EXCEL) ===
document.getElementById('btnExportar').addEventListener('click', () => {
    if (registrosGlobales.length === 0) return alert('No hay datos para exportar');

    const encabezados = [
        'Creado En', 'Técnico', 'Suministro', 'Distrito', 'Direccion', 'Año Fabricación',
        'Nro Medidor', 'Marca', 'Medidor Actual', 'Tipo Caja', 'Tipo Chapa', 'Fase',
        'Acometida', 'ITM', 'Impedimento', 'Submotivo'
    ];

    const filas = registrosGlobales.map(reg => {
        const datosSum = reg.suministros || {};
        return [
            formatearFechaLima(reg.creado_en),   // hora corregida a Lima
            reg.tecnico || '',
            reg.suministro,
            datosSum.distrito || '',
            datosSum.direccion || '',
            datosSum.anio_fabricacion || '',
            datosSum.numero_medidor || '',
            datosSum.marca || '',
            datosSum.medidor_actual || '',
            reg.tipo_caja,
            reg.tipo_chapa,
            reg.fase,
            reg.tipo_acometida,
            reg.itm_portafusible || '',
            reg.impedimento_cod,
            reg.submotivo_cod || ''
        ].map(escaparCSV).join(',');
    });

    // BOM (\uFEFF) para que Excel lea bien acentos y la ñ
    const csv = '\uFEFF' + encabezados.join(',') + '\n' + filas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

    descargarBlob(blob, `Catastro_Medidores_${new Date().toISOString().split('T')[0]}.csv`);
});

// === EXPORTAR FOTOS A ZIP (TODOS LOS REGISTROS) ===
document.getElementById('btnExportarFotos').addEventListener('click', async () => {
    if (registrosGlobales.length === 0) return alert('No hay datos para exportar');

    const btn = document.getElementById('btnExportarFotos');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const zip = new JSZip();
        const tareas = [];
        const contadorPorSuministro = new Map();
        let fallidas = 0, exitosas = 0, primerError = null;

        registrosGlobales.forEach(reg => {
            if (!Array.isArray(reg.fotos_urls) || reg.fotos_urls.length === 0) return;

            // Carpeta única: si el suministro se repite, se agrega sufijo _2, _3...
            const clave = String(reg.suministro);
            const n = (contadorPorSuministro.get(clave) || 0) + 1;
            contadorPorSuministro.set(clave, n);
            const nombreCarpeta = n === 1 ? clave : `${clave}_${n}`;

            reg.fotos_urls.forEach((url, i) => {
                tareas.push(async () => {
                    try {
                        const blob = await obtenerBlobFoto(url);
                        // La ruta crea la carpeta solo si la foto existe
                        zip.file(`${nombreCarpeta}/foto_${i + 1}.${extensionDeUrl(url)}`, blob);
                        exitosas++;
                    } catch (err) {
                        fallidas++;
                        if (!primerError) primerError = `${err.message || err} — ${url}`;
                        console.error(`Error foto ${i + 1} del suministro ${reg.suministro}:`, err);
                    }
                });
            });
        });

        if (tareas.length === 0) return alert('No hay fotos para exportar.');

        await ejecutarConLimite(tareas, CONCURRENCIA_FOTOS, (hecho, total) => {
            btn.innerHTML = `⏳ Descargando ${hecho}/${total}`;
        });

        if (exitosas === 0) {
            throw new Error(`Ninguna foto se pudo descargar. Primer error: ${primerError}`);
        }

        btn.innerHTML = '⏳ Armando ZIP...';
        const contenidoZip = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        descargarBlob(contenidoZip, `Fotos_Suministros_${new Date().toISOString().split('T')[0]}.zip`);

        if (fallidas > 0) alert(`Se omitieron ${fallidas} foto(s). Primer error: ${primerError}`);
    } catch (error) {
        console.error('Error general generando el ZIP: ', error);
        alert('No se pudo generar el ZIP.\n' + (error.message || error));
    } finally {
        btn.innerHTML = textoOriginal;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
});

// === MODAL DE FOTOS ===
const modal = document.getElementById('fotoModal');
const spanClose = document.getElementsByClassName('close')[0];
const galeriaGrid = document.getElementById('galeriaFotos');

function abrirModal(index) {
    galeriaGrid.innerHTML = '';
    const fotos = datosFiltrados[index].fotos_urls || [];
    
    galeriaGrid.innerHTML = fotos
        .map(url => `<a href="${escaparHTML(url)}" target="_blank" rel="noopener"><img src="${escaparHTML(url)}" alt="Evidencia"></a>`)
        .join('');
    
    modal.style.display = 'block';
}

spanClose.onclick = function() {
    modal.style.display = 'none';
};

window.onclick = function(event) {
    if (event.target == modal) {
        modal.style.display = 'none';
    }
};

// Inicializar
cargarRegistros();
