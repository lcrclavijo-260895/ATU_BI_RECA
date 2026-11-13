
const DATA_URL = './data/dashboard.json';

let data = null;
let charts = {};
let filtersInitialized = false;

const $ = id => document.getElementById(id);

const money = n => new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    maximumFractionDigits: 0
}).format(Number(n || 0));

const num = n => new Intl.NumberFormat('es-PE')
    .format(Number(n || 0));

const pct = n =>
    `${Number(n || 0).toFixed(1).replace('.', ',')}%`;

const colors = [
    '#176b87',
    '#159a91',
    '#d1a85b',
    '#8ba6bd',
    '#526f8b',
    '#83b8a8'
];

const stageColors = {
    COACTIVO: '#176b87',
    DFS: '#159a91',
    FRACCIONAMIENTO: '#d1a85b',
    'SIN CLASIFICAR': '#8ba6bd'
};

const subareaColors = {
    COACTIVO: '#176b87',
    'SD SANCION': '#159a91',
    'SD FISCALIZACION': '#d1a85b',
    FRACCIONAMIENTO: '#8ba6bd'
};

const dateOnly = value => String(value || '').slice(0, 10);
const amount = row => Number(row.Recaudacion || 0);
const count = row => Number(row.CantidadPagos || 0);

const safe = value => String(value ?? '').replace(
    /[&<>"']/g,
    char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char])
);

function notice(message) {
    $('notice').textContent = message;
}

function destroyCharts() {
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
}

function total(rows) {
    return rows.reduce((result, row) => ({
        amount: result.amount + amount(row),
        count: result.count + count(row)
    }), { amount: 0, count: 0 });
}

function group(rows, field) {
    const groups = new Map();

    rows.forEach(row => {
        const key = row[field] || 'SIN CLASIFICAR';

        if (!groups.has(key)) {
            groups.set(key, {
                label: key,
                amount: 0,
                count: 0
            });
        }

        const item = groups.get(key);
        item.amount += amount(row);
        item.count += count(row);
    });

    return [...groups.values()]
        .sort((a, b) => b.amount - a.amount);
}

function monthlySeries(rows) {
    const groups = new Map();

    rows.forEach(row => {
        const key = dateOnly(row.Fecha).slice(0, 7);

        if (!key) return;

        groups.set(key, (groups.get(key) || 0) + amount(row));
    });

    return [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]));
}

function variation(current, previous) {
    if (
        previous === undefined ||
        previous === null ||
        previous === 0
    ) {
        return null;
    }

    return ((current / previous) - 1) * 100;
}

function setVar(id, value, labelId, label) {
    const element = $(id);

    element.classList.remove('positive', 'negative', 'neutral');
    $(labelId).textContent = label;

    if (value === null || !Number.isFinite(value)) {
        element.textContent = '—';
        element.classList.add('neutral');
        return;
    }

    element.textContent =
        `${value > 0 ? '+' : ''}${pct(value)}`;

    element.classList.add(
        value > 0 ? 'positive' :
        value < 0 ? 'negative' : 'neutral'
    );
}

/* =========================================
   FILTROS
========================================= */

function selectedStages() {
    return [
        ...$('stageDropdownMenu').querySelectorAll(
            'input[type="checkbox"]:checked'
        )
    ].map(input => input.value);
}

function updateStageButton() {
    const stages = selectedStages();
    const text = $('stageDropdownText');

    if (stages.length === 0) {
        text.textContent = 'Todos los estadíos';
    } else if (stages.length === 1) {
        text.textContent = stages[0];
    } else {
        text.textContent = `${stages.length} estadíos seleccionados`;
    }
}

function initStageDropdown() {
    const button = $('stageDropdownButton');
    const menu = $('stageDropdownMenu');

    button.addEventListener('click', event => {
        event.stopPropagation();

        const open = menu.classList.toggle('show');
        button.setAttribute('aria-expanded', String(open));
    });

    menu.addEventListener('click', event => {
        event.stopPropagation();
    });

    menu.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', () => {
            updateStageButton();
            render();
        });
    });

    document.addEventListener('click', () => {
        menu.classList.remove('show');
        button.setAttribute('aria-expanded', 'false');
    });
}

function initFilters() {
    const years = [...new Set(
        data.diario_estadios.map(row =>
            Number(dateOnly(row.Fecha).slice(0, 4))
        )
    )].filter(Number.isFinite).sort((a, b) => a - b);

    const mainYear = $('mainYear');
    const yearA = $('compareYearA');
    const yearB = $('compareYearB');

    const previousMain = mainYear.value;
    const previousA = yearA.value;
    const previousB = yearB.value;

    mainYear.innerHTML = years.map(year =>
        `<option value="${year}">${year}</option>`
    ).join('');

    const comparisonOptions = years.map(year =>
        `<option value="${year}">${year}</option>`
    ).join('');

    yearA.innerHTML = comparisonOptions;
    yearB.innerHTML = comparisonOptions;

    if (years.length) {
        mainYear.value = years.includes(Number(previousMain))
            ? previousMain
            : years.at(-1);

        yearA.value = years.includes(Number(previousA))
            ? previousA
            : years.at(-2) ?? years.at(-1);

        yearB.value = years.includes(Number(previousB))
            ? previousB
            : years.at(-1);
    }

    yearA.disabled = years.length < 2;
    yearB.disabled = years.length < 2;

    if (!filtersInitialized) {
        $('dateFrom').addEventListener('change', render);
        $('dateTo').addEventListener('change', render);
        mainYear.addEventListener('change', render);

        yearA.addEventListener('change', render);
        yearB.addEventListener('change', render);

        initStageDropdown();

        filtersInitialized = true;
    }

    updateStageButton();
}

/*
El año principal define el ejercicio.
Las fechas Desde/Hasta acotan ese ejercicio.
El filtro de estadíos se aplica a todos los gráficos.
*/
function filtered() {
    const year = $('mainYear').value;
    const from = $('dateFrom').value;
    const to = $('dateTo').value;
    const stages = selectedStages();

    const isValid = row => {
        const date = dateOnly(row.Fecha);
        const rowYear = date.slice(0, 4);
        const stage = row.Estadio || 'SIN CLASIFICAR';

        return (
            (!year || rowYear === year) &&
            (!from || date >= from) &&
            (!to || date <= to) &&
            (!stages.length || stages.includes(stage))
        );
    };

    return {
        stages: data.diario_estadios.filter(isValid),
        subareas: data.diario_subareas.filter(isValid),
        banks: data.diario_bancos.filter(isValid),
        infractions: data.diario_faltas.filter(isValid)
    };
}

/* La comparación de años no depende del año principal.
   Sí respeta la selección de estadíos. */
function comparisonRows() {
    const stages = selectedStages();

    return data.diario_estadios.filter(row => {
        const stage = row.Estadio || 'SIN CLASIFICAR';

        return !stages.length || stages.includes(stage);
    });
}

function shareList(id, rows, grand) {
    $(id).innerHTML = rows.map((row, index) => {
        const color = stageColors[row.label] ||
            colors[index % colors.length];

        return `
            <div class="share-item">
                <div class="share-name">
                    <i class="share-dot" style="background:${color}"></i>
                    <span>${safe(row.label)}</span>
                </div>
                <span class="share-value">
                    ${pct(grand ? row.amount / grand * 100 : 0)}
                </span>
            </div>
        `;
    }).join('');
}

/* =========================================
   ETIQUETAS DE GRÁFICOS
========================================= */

const barLabelsPlugin = {
    id: 'barLabels',

    afterDatasetsDraw(chart) {
        const { ctx } = chart;

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (dataset.type === 'line') return;

            const meta = chart.getDatasetMeta(datasetIndex);

            meta.data.forEach((bar, index) => {
                const value = dataset.data[index];

                if (value === null || value === undefined || value === 0) {
                    return;
                }

                const position = bar.tooltipPosition();

                ctx.save();
                ctx.fillStyle = '#526b7d';
                ctx.font = '600 10px Inter, Arial';
                ctx.textBaseline = 'middle';

                if (chart.options.indexAxis === 'y') {
                    ctx.textAlign = 'left';
                    ctx.fillText(
                        money(value),
                        position.x + 7,
                        position.y
                    );
                } else {
                    ctx.textAlign = 'center';
                    ctx.fillText(
                        money(value),
                        position.x,
                        position.y - 10
                    );
                }

                ctx.restore();
            });
        });
    }
};

const doughnutCenterPlugin = {
    id: 'doughnutCenter',

    afterDraw(chart) {
        if (chart.config.type !== 'doughnut') return;

        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        const x = (chartArea.left + chartArea.right) / 2;
        const y = (chartArea.top + chartArea.bottom) / 2;

        const totalAmount = chart.data.datasets[0].data
            .reduce((sum, value) => sum + Number(value || 0), 0);

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#6e8192';
        ctx.font = '500 10px Inter, Arial';
        ctx.fillText('RECAUDACIÓN', x, y - 13);

        ctx.fillStyle = '#102b46';
        ctx.font = '800 16px Inter, Arial';
        ctx.fillText(money(totalAmount), x, y + 11);

        ctx.restore();
    }
};

/* =========================================
   GRÁFICO ANUAL
========================================= */

function renderAnnualChart(rows) {
    const selectedYear = $('mainYear').value;

    const months = [
        'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
        'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
    ];

    const monthlyAmounts = Array(12).fill(0);
    const monthlyCounts = Array(12).fill(0);

    rows.forEach(row => {
        const date = dateOnly(row.Fecha);
        const month = Number(date.slice(5, 7)) - 1;

        if (month < 0 || month > 11) return;

        monthlyAmounts[month] += amount(row);
        monthlyCounts[month] += count(row);
    });

    charts.annual = new Chart($('annualChart'), {
        type: 'bar',

        data: {
            labels: months,

            datasets: [{
                label: `Recaudación ${selectedYear}`,
                data: monthlyAmounts,
                counts: monthlyCounts,
                backgroundColor: '#176b87',
                hoverBackgroundColor: '#159a91',
                borderRadius: 5,
                maxBarThickness: 34
            }]
        },

        plugins: [barLabelsPlugin],

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                },

                tooltip: {
                    callbacks: {
                        label(context) {
                            return [
                                `Recaudación: ${money(context.raw)}`,
                                `Registros: ${num(
                                    context.dataset.counts[context.dataIndex]
                                )}`
                            ];
                        }
                    }
                }
            },

            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#718596' }
                },

                y: {
                    beginAtZero: true,
                    grid: { color: '#e9eef2' },
                    ticks: {
                        color: '#718596',
                        callback: value => 'S/ ' + num(value)
                    }
                }
            }
        }
    });
}

/* =========================================
   COMPARACIÓN DE DOS AÑOS
========================================= */

function renderComparisonChart(rows) {
    const yearA = Number($('compareYearA').value);
    const yearB = Number($('compareYearB').value);

    const months = [
        'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
        'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
    ];

    const totalsByYear = new Map();

    rows.forEach(row => {
        const date = dateOnly(row.Fecha);
        const year = Number(date.slice(0, 4));
        const month = Number(date.slice(5, 7)) - 1;

        if (year !== yearA && year !== yearB) return;

        if (!totalsByYear.has(year)) {
            totalsByYear.set(year, Array(12).fill(0));
        }

        totalsByYear.get(year)[month] += amount(row);
    });

    const valuesA = totalsByYear.get(yearA) || Array(12).fill(0);
    const valuesB = totalsByYear.get(yearB) || Array(12).fill(0);

    const variations = valuesA.map((base, index) =>
        base === 0 ? null : variation(valuesB[index], base)
    );

    charts.month = new Chart($('monthlyChart'), {
        type: 'bar',

        data: {
            labels: months,

            datasets: [
                {
                    type: 'bar',
                    label: String(yearA),
                    data: valuesA,
                    backgroundColor: '#176b87',
                    borderRadius: 4,
                    maxBarThickness: 25,
                    yAxisID: 'y'
                },
                {
                    type: 'bar',
                    label: String(yearB),
                    data: valuesB,
                    backgroundColor: '#159a91',
                    borderRadius: 4,
                    maxBarThickness: 25,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: `Variación ${yearB} vs. ${yearA}`,
                    data: variations,
                    borderColor: '#d1a85b',
                    backgroundColor: '#d1a85b',
                    pointRadius: 4,
                    borderWidth: 2,
                    tension: 0.25,
                    spanGaps: false,
                    yAxisID: 'y1'
                }
            ]
        },

        plugins: [barLabelsPlugin],

        options: {
            responsive: true,
            maintainAspectRatio: false,

            interaction: {
                mode: 'index',
                intersect: false
            },

            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 9,
                        color: '#526b7d',
                        font: { size: 10 }
                    }
                },

                tooltip: {
                    callbacks: {
                        label(context) {
                            if (context.dataset.type === 'line') {
                                return `Variación: ${
                                    context.raw === null
                                        ? 'No comparable'
                                        : pct(context.raw)
                                }`;
                            }

                            return `${context.dataset.label}: ${
                                money(context.raw)
                            }`;
                        }
                    }
                }
            },

            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#718596' }
                },

                y: {
                    beginAtZero: true,
                    position: 'left',
                    grid: { color: '#e9eef2' },
                    ticks: {
                        color: '#718596',
                        callback: value => 'S/ ' + num(value)
                    }
                },

                y1: {
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#b38a3e',
                        callback: value => pct(value)
                    }
                }
            }
        }
    });
}

/* =========================================
   GRÁFICO POR ESTADÍO
========================================= */

function renderStageChart(rows, grandTotal) {
    const stages = group(rows, 'Estadio');

    charts.sub = new Chart($('subareaChart'), {
        type: 'doughnut',

        data: {
            labels: stages.map(row => row.label),

            datasets: [{
                data: stages.map(row => row.amount),
                counts: stages.map(row => row.count),

                backgroundColor: stages.map(row =>
                    stageColors[row.label] || '#8ba6bd'
                ),

                borderColor: '#fff',
                borderWidth: 3
            }]
        },

        plugins: [doughnutCenterPlugin],

        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',

            plugins: {
                legend: { display: false },

                tooltip: {
                    callbacks: {
                        label(context) {
                            const value = Number(context.raw || 0);
                            const records =
                                context.dataset.counts[context.dataIndex];

                            return [
                                context.label,
                                `Recaudación: ${money(value)}`,
                                `Participación: ${pct(
                                    grandTotal
                                        ? value / grandTotal * 100
                                        : 0
                                )}`,
                                `Registros: ${num(records)}`
                            ];
                        }
                    }
                }
            }
        }
    });

    shareList('subareaLegend', stages, grandTotal);
}

/* =========================================
   GRÁFICO POR SUBÁREA
========================================= */

function renderSubareaChart(rows, grandTotal) {
    const subareas = group(rows, 'SubArea');

    charts.subareaDetail = new Chart($('subareaDetailChart'), {
        type: 'bar',

        data: {
            labels: subareas.map(row => row.label),

            datasets: [{
                label: 'Recaudación',
                data: subareas.map(row => row.amount),
                counts: subareas.map(row => row.count),

                backgroundColor: subareas.map(row =>
                    subareaColors[row.label] || '#8ba6bd'
                ),

                borderRadius: 5,
                maxBarThickness: 38
            }]
        },

        plugins: [barLabelsPlugin],

        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: { display: false },

                tooltip: {
                    callbacks: {
                        label(context) {
                            const value = Number(context.raw || 0);
                            const records =
                                context.dataset.counts[context.dataIndex];

                            return [
                                `Recaudación: ${money(value)}`,
                                `Participación: ${pct(
                                    grandTotal
                                        ? value / grandTotal * 100
                                        : 0
                                )}`,
                                `Registros: ${num(records)}`
                            ];
                        }
                    }
                }
            },

            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#e9eef2' },
                    ticks: {
                        color: '#718596',
                        callback: value => 'S/ ' + num(value)
                    }
                },

                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#526b7d',
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

/* =========================================
   GRÁFICO POR BANCO
========================================= */

function renderBankChart(rows, grandTotal) {
    const banks = group(rows, 'EntidadPago');

    charts.bank = new Chart($('bankChart'), {
        type: 'bar',

        data: {
            labels: banks.map(row => row.label),

            datasets: [{
                data: banks.map(row => row.amount),
                counts: banks.map(row => row.count),
                backgroundColor: '#159a91',
                hoverBackgroundColor: '#087d78',
                borderRadius: 5,
                maxBarThickness: 26
            }]
        },

        plugins: [barLabelsPlugin],

        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: { display: false },

                tooltip: {
                    callbacks: {
                        label(context) {
                            const value = Number(context.raw || 0);
                            const records =
                                context.dataset.counts[context.dataIndex];

                            return [
                                `Recaudación: ${money(value)}`,
                                `Participación: ${pct(
                                    grandTotal
                                        ? value / grandTotal * 100
                                        : 0
                                )}`,
                                `Registros: ${num(records)}`
                            ];
                        }
                    }
                }
            },

            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#e9eef2' },
                    ticks: {
                        color: '#718596',
                        callback: value => 'S/ ' + num(value)
                    }
                },

                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#526b7d',
                        font: { size: 10 }
                    }
                }
            }
        }
    });

    shareList('bankLegend', banks, grandTotal);
}

/* =========================================
   RANKING TOP 10
========================================= */

function renderRanking(rows) {
    const infractions = group(rows, 'Falta');

    $('infractionsTable').innerHTML = infractions
        .slice(0, 10)
        .map((row, index) => `
            <tr>
                <td>
                    <span class="rank-pill">${index + 1}</span>
                </td>
                <td><strong>${safe(row.label)}</strong></td>
                <td class="numeric">${num(row.count)}</td>
                <td class="numeric table-amount">${money(row.amount)}</td>
            </tr>
        `).join('') ||
        '<tr><td colspan="4">No hay datos para los filtros seleccionados</td></tr>';
}

/* =========================================
   RENDER GENERAL
========================================= */

function render() {
    if (!data) return;

    const filteredData = filtered();

    const totals = total(filteredData.stages);
    const stages = group(filteredData.stages, 'Estadio');
    const months = monthlySeries(filteredData.stages);

    $('kpiAmount').textContent = money(totals.amount);
    $('kpiCount').textContent = num(totals.count);

    const dates = filteredData.stages
        .map(row => dateOnly(row.Fecha))
        .sort();

    $('kpiMinDate').textContent = dates[0] || '—';
    $('kpiMaxDate').textContent = dates.at(-1) || '—';
    $('leadingSubarea').textContent = stages[0]?.label || '—';

// =========================================
// VARIACIONES MENSUAL E INTERANUAL
// =========================================

// Los periodos de comparación no deben limitarse
// por los filtros Desde/Hasta ni por el año principal.
    const comparisonMonths = monthlySeries(comparisonRows());
    const monthLookup = new Map(comparisonMonths);

// El mes de referencia se obtiene del filtro Hasta.
// Si no existe, se utiliza Desde o la última fecha disponible.
    const selectedPeriod =
        $('dateTo').value ||
        $('dateFrom').value ||
        dates.at(-1) ||
        '';

    const targetMonth = dateOnly(selectedPeriod).slice(0, 7);

    let previousMonth = null;
    let previousYear = null;

    if (targetMonth) {
        const [year, month] = targetMonth.split('-').map(Number);

        const previousMonthDate = new Date(year, month - 2, 1);
        const previousYearDate = new Date(year - 1, month - 1, 1);

        previousMonth =
        `${previousMonthDate.getFullYear()}-${String(
            previousMonthDate.getMonth() + 1
        ).padStart(2, '0')}`;

        previousYear =
        `${previousYearDate.getFullYear()}-${String(
            previousYearDate.getMonth() + 1
        ).padStart(2, '0')}`;
    }

    const currentAmount = monthLookup.get(targetMonth);

    setVar(
        'kpiMonthlyVariation',
        currentAmount === undefined
        ? null
        : variation(currentAmount, monthLookup.get(previousMonth)),
        'monthlyVariationLabel',
        targetMonth
        ? `${targetMonth} vs. mes anterior`
        : 'Sin periodo comparable'
    );

    setVar(
        'kpiYearlyVariation',
        currentAmount === undefined
        ? null
        : variation(currentAmount, monthLookup.get(previousYear)),
        'yearlyVariationLabel',
        targetMonth
        ? `${targetMonth} vs. mismo mes del año anterior`
        : 'Sin periodo comparable'
    );

    const updated = data.metadata?.updated_at || 'No disponible';

    $('cutoff').textContent =
        'Actualizado: ' + updated.replace('T', ' ');

    destroyCharts();

    renderAnnualChart(filteredData.stages);

    renderComparisonChart(comparisonRows());

    renderStageChart(filteredData.stages, totals.amount);

    renderSubareaChart(filteredData.subareas, totals.amount);

    renderBankChart(filteredData.banks, totals.amount);

    renderRanking(filteredData.infractions);

    notice(
        totals.count
            ? `Información filtrada correctamente · ${
                num(totals.count)
            } registros · Corte: ${updated}`
            : 'No existen registros para los filtros seleccionados.'
    );
}

/* =========================================
   CARGA DE DATOS
========================================= */

async function load() {
    notice('Cargando información…');

    try {
        const response = await fetch(DATA_URL + '?t=' + Date.now());

        if (!response.ok) {
            throw new Error('No se pudo leer dashboard.json');
        }

        data = await response.json();

        const required = [
            'diario_subareas',
            'diario_estadios',
            'diario_bancos',
            'diario_faltas'
        ];

        const missing = required.filter(key =>
            !Array.isArray(data[key])
        );

        if (missing.length) {
            throw new Error(
                'Faltan resúmenes requeridos: ' + missing.join(', ')
            );
        }

        initFilters();
        render();

    } catch (error) {
        console.error(error);
        notice('Error al cargar los datos: ' + error.message);
    }
}

/* =========================================
   BOTONES
========================================= */

$('reload').onclick = load;

$('clearFilters').onclick = () => {
    $('dateFrom').value = '';
    $('dateTo').value = '';

    const years = [...new Set(
        data.diario_estadios.map(row =>
            Number(dateOnly(row.Fecha).slice(0, 4))
        )
    )].filter(Number.isFinite).sort((a, b) => a - b);

    if (years.length) {
        $('mainYear').value = years.at(-1);
    }

    $('stageDropdownMenu')
        .querySelectorAll('input[type="checkbox"]')
        .forEach(input => {
            input.checked = false;
        });

    updateStageButton();
    render();
};

load();
