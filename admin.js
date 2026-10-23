const supabaseUrl = 'https://kseaqcwhsvenxtmpqjvu.supabase.co'; // REEMPLAZAR
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzZWFxY3doc3Zlbnh0bXBxanZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzA3NzYsImV4cCI6MjEwODM0Njc3Nn0.xb0jWWmc1AAplHZ_Whgy3d-OCvsQyKHR3W6zFpvcKvA'; // REEMPLAZAR
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// === PROTECCIÓN DE RUTA ===
async function verificarAcceso() {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (!session || error) {
        window.location.href = 'login.html'; // Expulsa al usuario no autenticado
    }
}
verificarAcceso();

// === CERRAR SESIÓN ===
async function cerrarSesion() {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
}

let registrosGlobales = [];

async function cargarRegistros() {
    const { data, error } = await supabase
        .from('registros_catastro')
        .select('*, suministros(medidor, marca_nombre)')
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
        const medidorInfo = reg.suministros ? `${reg.suministros.medidor} <br><small>${reg.suministros.marca_nombre}</small>` : 'N/A';
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
    // Cabeceras actualizadas con ITM
    csvContent += "Fecha,Suministro,Medidor,Marca,Tipo Caja,Tipo Chapa,Fase,Acometida,ITM,Impedimento,Submotivo\n";

    registrosGlobales.forEach(reg => {
        const fecha = new Date(reg.creado_en).toLocaleString('es-PE').replace(',', '');
        const med = reg.suministros ? reg.suministros.medidor : '';
        const marca = reg.suministros ? reg.suministros.marca_nombre : '';
        const itm = reg.itm_portafusible ? reg.itm_portafusible : '';
        const sub = reg.submotivo_cod ? reg.submotivo_cod : '';
        
        let row = `${fecha},${reg.suministro},${med},${marca},${reg.tipo_caja},${reg.tipo_chapa},${reg.fase},${reg.tipo_acometida},${itm},${reg.impedimento_cod},${sub}`;
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