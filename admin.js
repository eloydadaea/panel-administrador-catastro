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

// === CARGAR Y UNIR DATOS MANUALMENTE ===
async function cargarRegistros() {
    // 1. Traer solo los registros_catastro
    const { data: registros, error: errorRegistros } = await clienteSupabase
        .from('registros_catastro')
        .select('*')
        .order('creado_en', { ascending: false });

    if (errorRegistros) {
        console.error("Error al cargar registros:", errorRegistros);
        return;
    }

    // 2. Extraer todos los números de suministro únicos de esos registros
    const suministrosUnicos = [...new Set(registros.map(r => r.suministro))].filter(s => s != null);

    let suministrosData = [];

    // 3. Traer la información de la tabla 'suministros' SOLO para esos números
    if (suministrosUnicos.length > 0) {
        const { data: suministros, error: errorSuministros } = await clienteSupabase
            .from('suministros')
            .select('suministro, medidor_actual, distrito, direccion, anio_fabricacion, numero_medidor, marca')
            .in('suministro', suministrosUnicos); // Filtra para no descargar toda la base de datos

        if (errorSuministros) {
            console.error("Error al cargar tabla suministros:", errorSuministros);
        } else {
            suministrosData = suministros;
        }
    }

    // 4. Unir ambas tablas (Hacer el Match manualmente)
    registrosGlobales = registros.map(reg => {
        // Buscamos si existe el suministro en la segunda tabla
        const infoSuministro = suministrosData.find(s => s.suministro == reg.suministro);
        
        // Retornamos el registro combinando la info (si no hay, agregamos un objeto vacío)
        return {
            ...reg,
            suministros: infoSuministro || {} 
        };
    });

    // 5. Renderizar la tabla con los datos ya cruzados
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
        
        const datosSum = reg.suministros;

        const medidorInfo = datosSum && datosSum.distrito 
            ? `${datosSum.medidor_actual || 'S/D'} <br><small>${datosSum.distrito || 'S/D'}</small>` 
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
    
    // BOM para los acentos en Excel
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    
    csvContent += "Creado En,Técnico,Suministro,Distrito,Direccion,Año Fabricación,Nro Medidor,Marca,Medidor Actual,Tipo Caja,Tipo Chapa,Fase,Acometida,ITM,Impedimento,Submotivo\n";

    registrosGlobales.forEach(reg => {
        const creado_en = reg.creado_en ? new Date(reg.creado_en).toLocaleString('es-PE').replace(',', '') : '';
        const tecnico = reg.tecnico || '';
        
        const datosSum = reg.suministros || {};

        const distrito = datosSum.distrito || '';
        const direccion = datosSum.direccion ? datosSum.direccion.replace(/,/g, ' ') : ''; 
        const anio_fabricacion = datosSum.anio_fabricacion || '';
        const numero_medidor = datosSum.numero_medidor || '';
        const marca = datosSum.marca || '';
        const med_actual = datosSum.medidor_actual || '';
        
        const itm = reg.itm_portafusible || '';
        const sub = reg.submotivo_cod || '';
        
        let row = `${creado_en},${tecnico},${reg.suministro},${distrito},${direccion},${anio_fabricacion},${numero_medidor},${marca},${med_actual},${reg.tipo_caja},${reg.tipo_chapa},${reg.fase},${reg.tipo_acometida},${itm},${reg.impedimento_cod},${sub}`;
        
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
    
    btn.innerHTML = '⏳ Generando ZIP (Puede demorar)...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const zip = new JSZip();
        const promesasFetch = [];

        registrosGlobales.forEach(reg => {
            if (reg.fotos_urls && reg.fotos_urls.length > 0) {
                const carpetaSuministro = zip.folder(reg.suministro.toString());

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
                        .catch(err => console.error(`Error al descargar imagen del suministro ${reg.suministro}:`, err));

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
