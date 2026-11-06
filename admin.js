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

// === CARGAR Y UNIR DATOS MANUALMENTE EN BLOQUES ===
async function cargarRegistros() {
    const { data: registros, error: errorRegistros } = await clienteSupabase
        .from('registros_catastro')
        .select('*')
        .order('creado_en', { ascending: false });

    if (errorRegistros) {
        console.error("Error al cargar registros:", errorRegistros);
        return;
    }

    const suministrosUnicos = [...new Set(registros.map(r => r.suministro))].filter(Boolean);
    let suministrosData = [];

    // Pedimos la data a Supabase en bloques de 100 para no saturar la petición
    if (suministrosUnicos.length > 0) {
        for (let i = 0; i < suministrosUnicos.length; i += 100) {
            const bloque = suministrosUnicos.slice(i, i + 100);
            
            const { data: bloqueDatos, error: errorSuministros } = await clienteSupabase
                .from('suministros')
                .select('suministro, medidor_actual, distrito, direccion, anio_fabricacion, numero_medidor, marca')
                .in('suministro', bloque);

            if (errorSuministros) {
                console.error(`Error cargando bloque de suministros:`, errorSuministros);
            } else if (bloqueDatos) {
                suministrosData.push(...bloqueDatos);
            }
        }
    }

    // Cruzamos la información
    registrosGlobales = registros.map(reg => {
        const infoSuministro = suministrosData.find(s => s.suministro == reg.suministro);
        return {
            ...reg,
            suministros: infoSuministro || {} 
        };
    });

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
        const fecha = new Date(reg.creado_en).toLocaleString('es-PE');
        const datosSum = reg.suministros || {};

        const medidorInfo = datosSum.distrito 
            ? `${datosSum.medidor_actual || 'S/D'} <br><small>${datosSum.distrito || 'S/D'}</small>` 
            : 'N/A';
            
        const submotivo = reg.submotivo_cod ? ` - ${reg.submotivo_cod}` : '';
        const itm = reg.itm_portafusible || 'N/A';
        
        const tieneFotos = reg.fotos_urls && reg.fotos_urls.length > 0;
        const btnFotos = tieneFotos 
            ? `<div class="evidencia-acciones">
                   <button class="btn-fotos" onclick="abrirModal(${index})">Ver ${reg.fotos_urls.length} Fotos</button>
                   <button class="btn-descargar-fotos" title="Descargar fotos del suministro ${reg.suministro}" onclick="descargarFotosSuministro(${index}, this)">⬇ Descargar</button>
               </div>`
            : '<span style="color:#999; font-size:0.8rem;">Sin fotos</span>';

        html += `
            <tr>
                <td>${fecha}</td>
                <td><strong>${reg.suministro}</strong></td>
                <td>${medidorInfo}</td>
                <td>${reg.tipo_caja} / ${reg.tipo_chapa}</td>
                <td>${reg.fase} / ${reg.tipo_acometida}</td>
                <td>${itm}</td>
                <td><strong>${reg.impedimento_cod}</strong>${submotivo}</td>
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

    let filtrados = registrosGlobales.filter(reg => {
        let cumpleSum = sumFiltro === '' || String(reg.suministro).includes(sumFiltro);
        let cumpleImp = impFiltro === '' || reg.impedimento_cod === impFiltro;
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
        const carpeta = zip.folder(String(reg.suministro));

        const resultados = await Promise.all(reg.fotos_urls.map(async (url, i) => {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                const extension = url.split('.').pop().split('?')[0] || 'jpg';
                carpeta.file(`foto_${i + 1}.${extension}`, blob);
                return true;
            } catch (err) {
                console.error(`Error foto ${i + 1} del suministro ${reg.suministro}:`, err);
                return false;
            }
        }));

        if (!resultados.some(Boolean)) {
            throw new Error('No se pudo descargar ninguna foto.');
        }

        const contenidoZip = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(contenidoZip);
        link.download = `Fotos_${reg.suministro}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        const fallidas = resultados.filter(r => !r).length;
        if (fallidas > 0) alert(`Se omitieron ${fallidas} foto(s) que no se pudieron descargar.`);
    } catch (error) {
        console.error('Error generando ZIP del suministro:', error);
        alert('Ocurrió un error al generar el archivo ZIP.');
    } finally {
        boton.innerHTML = textoOriginal;
        boton.disabled = false;
    }
}

// === FUNCIÓN PARA ESCAPAR COMAS Y EVITAR DESPLAZAMIENTO EN CSV ===
function escaparCSV(valor) {
    if (valor === null || valor === undefined) return '""';
    // Reemplaza saltos de línea por espacios y envuelve todo en comillas dobles
    let stringLimpiado = String(valor).replace(/\n/g, ' ').replace(/"/g, '""');
    return `"${stringLimpiado}"`;
}

// === EXPORTAR A CSV (EXCEL) ===
document.getElementById('btnExportar').addEventListener('click', () => {
    if(registrosGlobales.length === 0) return alert('No hay datos para exportar');
    
    // BOM para que Excel lea correctamente los acentos y la letra ñ
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Creado En,Técnico,Suministro,Distrito,Direccion,Año Fabricación,Nro Medidor,Marca,Medidor Actual,Tipo Caja,Tipo Chapa,Fase,Acometida,ITM,Impedimento,Submotivo\n";

    registrosGlobales.forEach(reg => {
        const creado_en = reg.creado_en ? new Date(reg.creado_en).toLocaleString('es-PE') : '';
        const tecnico = reg.tecnico || '';
        const datosSum = reg.suministros || {};

        const distrito = datosSum.distrito || '';
        const direccion = datosSum.direccion || '';
        const anio_fabricacion = datosSum.anio_fabricacion || '';
        const numero_medidor = datosSum.numero_medidor || '';
        const marca = datosSum.marca || '';
        const med_actual = datosSum.medidor_actual || '';
        
        const itm = reg.itm_portafusible || '';
        const sub = reg.submotivo_cod || '';
        
        // Formamos la fila aplicando "escaparCSV" a cada dato para que las comas no rompan la tabla
        let row = [
            escaparCSV(creado_en),
            escaparCSV(tecnico),
            escaparCSV(reg.suministro),
            escaparCSV(distrito),
            escaparCSV(direccion),
            escaparCSV(anio_fabricacion),
            escaparCSV(numero_medidor),
            escaparCSV(marca),
            escaparCSV(med_actual),
            escaparCSV(reg.tipo_caja),
            escaparCSV(reg.tipo_chapa),
            escaparCSV(reg.fase),
            escaparCSV(reg.tipo_acometida),
            escaparCSV(itm),
            escaparCSV(reg.impedimento_cod),
            escaparCSV(sub)
        ].join(','); // Unimos los datos con coma
        
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Catastro_Medidores_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// === EXPORTAR FOTOS A ZIP (TODOS LOS REGISTROS) ===
document.getElementById('btnExportarFotos').addEventListener('click', async () => {
    if (registrosGlobales.length === 0) return alert('No hay datos para exportar');

    const btn = document.getElementById('btnExportarFotos');
    const textoOriginal = btn.innerHTML;
    
    btn.innerHTML = '⏳ Generando ZIP...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const zip = new JSZip();
        const promesasFetch = [];

        registrosGlobales.forEach(reg => {
            if (reg.fotos_urls && reg.fotos_urls.length > 0) {
                const carpetaSuministro = zip.folder(String(reg.suministro));

                reg.fotos_urls.forEach((url, index) => {
                    const promesa = fetch(url)
                        .then(response => {
                            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                            return response.blob();
                        })
                        .then(blob => {
                            const extension = url.split('.').pop().split('?')[0] || 'jpg';
                            const nombreArchivo = `foto_${index + 1}.${extension}`;
                            carpetaSuministro.file(nombreArchivo, blob);
                        })
                        .catch(err => console.error(`Error foto suministro ${reg.suministro}:`, err));

                    promesasFetch.push(promesa);
                });
            }
        });

        await Promise.all(promesasFetch);

        const contenidoZip = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(contenidoZip);
        link.download = `Fotos_Suministros_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

    } catch (error) {
        console.error("Error general generando el ZIP: ", error);
        alert('Ocurrió un error al intentar generar el archivo ZIP.');
    } finally {
        btn.innerHTML = textoOriginal;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
});

// === MODAL DE FOTOS ===
const modal = document.getElementById("fotoModal");
const spanClose = document.getElementsByClassName("close")[0];
const galeriaGrid = document.getElementById("galeriaFotos");

function abrirModal(index) {
    galeriaGrid.innerHTML = '';
    const fotos = datosFiltrados[index].fotos_urls;
    
    fotos.forEach(url => {
        galeriaGrid.innerHTML += `<a href="${url}" target="_blank"><img src="${url}" alt="Evidencia"></a>`;
    });
    
    modal.style.display = "block";
}

spanClose.onclick = function() {
    modal.style.display = "none";
}

window.onclick = function(event) {
    if (event.target == modal) {
        modal.style.display = "none";
    }
}

// Inicializar
cargarRegistros();
