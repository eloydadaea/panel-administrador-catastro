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

async function cargarRegistros() {
    // CORRECCIÓN: Se solicitan las nuevas columnas de la tabla suministros
    const { data, error } = await clienteSupabase
        .from('registros_catastro')
        .select('*, suministros(medidor_actual, distrito, direccion)')
        .order('creado_en', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    registrosGlobales = data;
    renderizarTabla(registrosGlobales);
}

function renderizarTabla(datos) {
    const tbody = document.querySelector('#tablaRegistros tbody');
    tbody.innerHTML = '';

    if(datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No se encontraron registros.</td></tr>';
        return;
    }

    datos.forEach((reg, index) => {
        const fecha = new Date(reg.creado_en).toLocaleString('es-PE');
        
        // CORRECCIÓN: Mostrar Medidor Actual y Distrito
        const medidorInfo = reg.suministros 
            ? `${reg.suministros.medidor_actual || 'S/D'} <br><small>${reg.suministros.distrito || 'S/D'}</small>` 
            : 'N/A';
            
        const submotivo = reg.submotivo_cod ? ` - ${reg.submotivo_cod}` : '';
        const itm = reg.itm_portafusible || 'N/A';
        
        const tieneFotos = reg.fotos_urls && reg.fotos_urls.length > 0;
        const btnFotos = tieneFotos 
            ? `<button class="btn-fotos" onclick="abrirModal(${index})">Ver ${reg.fotos_urls.length} Fotos</button>` 
            : '<span style="color:#999; font-size:0.8rem;">Sin fotos</span>';

        tbody.innerHTML += `
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
}

// === LÓGICA DE FILTROS ===
document.getElementById('btnFiltrar').addEventListener('click', () => {
    const sumFiltro = document.getElementById('filtroSuministro').value;
    const impFiltro = document.getElementById('filtroImpedimento').value;

    let filtrados = registrosGlobales.filter(reg => {
        let cumpleSum = sumFiltro === '' || reg.suministro.toString().includes(sumFiltro);
        let cumpleImp = impFiltro === '' || reg.impedimento_cod === impFiltro;
        return cumpleSum && cumpleImp;
    });

    renderizarTabla(filtrados);
});

// === EXPORTAR A CSV (EXCEL) ===
document.getElementById('btnExportar').addEventListener('click', () => {
    if(registrosGlobales.length === 0) return alert('No hay datos para exportar');
    
    let csvContent = "data:text/csv;charset=utf-8,";
    
    // CORRECCIÓN: Nuevas cabeceras para el Excel
    csvContent += "Fecha,Suministro,Medidor Actual,Distrito,Direccion,Tipo Caja,Tipo Chapa,Fase,Acometida,ITM,Impedimento,Submotivo\n";

    registrosGlobales.forEach(reg => {
        const fecha = new Date(reg.creado_en).toLocaleString('es-PE').replace(',', '');
        const med = reg.suministros?.medidor_actual || '';
        const distrito = reg.suministros?.distrito || '';
        const direccion = reg.suministros?.direccion ? reg.suministros.direccion.replace(/,/g, ' ') : ''; // Quitamos comas para no romper el CSV
        
        const itm = reg.itm_portafusible || '';
        const sub = reg.submotivo_cod || '';
        
        let row = `${fecha},${reg.suministro},${med},${distrito},${direccion},${reg.tipo_caja},${reg.tipo_chapa},${reg.fase},${reg.tipo_acometida},${itm},${reg.impedimento_cod},${sub}`;
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

// === EXPORTAR FOTOS A ZIP ===
document.getElementById('btnExportarFotos').addEventListener('click', async () => {
    if (registrosGlobales.length === 0) return alert('No hay datos para exportar');

    const btn = document.getElementById('btnExportarFotos');
    const textoOriginal = btn.innerHTML;
    
    // Cambiar estado del botón para indicar que está procesando
    btn.innerHTML = '⏳ Generando ZIP (Puede demorar)...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const zip = new JSZip();
        const promesasFetch = [];

        // Recorrer todos los registros globales
        registrosGlobales.forEach(reg => {
            if (reg.fotos_urls && reg.fotos_urls.length > 0) {
                // Crear una carpeta con el número del suministro
                const carpetaSuministro = zip.folder(reg.suministro.toString());

                // Iterar sobre las URLs de las fotos de este registro
                reg.fotos_urls.forEach((url, index) => {
                    const promesa = fetch(url)
                        .then(response => {
                            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                            return response.blob();
                        })
                        .then(blob => {
                            // Extraer extensión de la URL (usualmente .jpg o .png)
                            const extension = url.split('.').pop().split('?')[0] || 'jpg';
                            const nombreArchivo = `foto_${index + 1}.${extension}`;
                            
                            // Guardar el blob de la imagen en la carpeta correspondiente
                            carpetaSuministro.file(nombreArchivo, blob);
                        })
                        .catch(err => console.error(`Error al descargar imagen del suministro ${reg.suministro}:`, err));

                    promesasFetch.push(promesa);
                });
            }
        });

        // Esperar a que TODAS las imágenes se hayan descargado
        await Promise.all(promesasFetch);

        // Generar el archivo ZIP
        const contenidoZip = await zip.generateAsync({ type: "blob" });
        
        // Forzar la descarga en el navegador
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
        // Restaurar el botón
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
    const fotos = registrosGlobales[index].fotos_urls;
    
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
