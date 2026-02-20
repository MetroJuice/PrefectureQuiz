document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    const state = {
        gameMode: 'quiz_pref', // 'quiz_pref' | 'quiz_cap' | 'memorize'
        cleared: new Set(),
        selectedMapId: null, // ID from SVG (1-47)
        selectedListId: null, // ID from List (1-47)
        isLocked: false // Lock interaction during animations
    };

    // --- DOM Elements ---
    const mapContainer = document.getElementById('mapContainer');
    const prefectureList = document.getElementById('prefectureList');
    const infoModal = document.getElementById('infoModal');
    const progressCount = document.getElementById('progressCount');
    const feedbackIcon = document.getElementById('feedbackIcon');
    const themeToggle = document.getElementById('themeToggle');
    const gameModeSelect = document.getElementById('gameModeSelect');
    const listSection = document.querySelector('.list-section');

    // Zoom Controls
    let zoomInBtn, zoomOutBtn, zoomResetBtn;

    // --- Initialization ---
    initGame();

    async function initGame() {
        initTheme();
        await loadMap();
        renderList();
        setupEventListeners();
        updateGameMode(); // Init UI
    }

    function initTheme() {
        if (!themeToggle) return;
        const saved = localStorage.getItem('theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
            themeToggle.textContent = saved === 'dark' ? '☀️' : '🌙';
        }
    }

    // --- Map Handling ---
    async function loadMap() {
        try {
            const response = await fetch('assets/japan.svg');
            if (!response.ok) throw new Error('Failed to load map');
            const svgText = await response.text();

            // Re-create Controls
            const buttonsHTML = `
                <div class="zoom-controls">
                    <button id="zoomIn" class="zoom-btn">+</button>
                    <button id="zoomReset" class="zoom-btn">⟲</button>
                    <button id="zoomOut" class="zoom-btn">-</button>
                </div>
            `;

            mapContainer.innerHTML = svgText + buttonsHTML;

            // Bind buttons
            bindZoomButtons();

            const svg = mapContainer.querySelector('svg');
            if (svg) {
                svg.id = 'japan-map';

                // Remove Title tags
                svg.querySelectorAll('title').forEach(el => el.remove());

                const prefs = svg.querySelectorAll('.prefecture');
                prefs.forEach(el => {
                    const code = parseInt(el.getAttribute('data-code'), 10);
                    const prefData = prefectureData.find(p => p.id === code);
                    if (prefData) {
                        el.classList.add(`region-${prefData.region}`);
                    }

                    // Click only
                    el.addEventListener('click', (e) => handleMapClick(e, el));
                });

                // Init Zoom/Pan
                setupZoomPan(svg);
            }
        } catch (error) {
            console.error(error);
            mapContainer.innerHTML = '<p class="error">地図の読み込みに失敗しました。</p>';
        }
    }

    // --- Zoom & Pan Logic ---
    function setupZoomPan(svg) {
        let scale = 1;
        let pointX = 0;
        let pointY = 0;
        let isPanning = false;
        let startPt = { x: 0, y: 0 };
        const container = mapContainer;

        const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
        wrapper.id = "viewport-wrapper";

        // Add an invisible background rect to capture drag events on empty spaces
        const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bgRect.setAttribute("width", "100%");
        bgRect.setAttribute("height", "100%");
        bgRect.setAttribute("fill", "transparent");
        wrapper.appendChild(bgRect);

        while (svg.firstChild) {
            wrapper.appendChild(svg.firstChild);
        }
        svg.appendChild(wrapper);

        function updateTransform() {
            wrapper.setAttribute('transform', `translate(${pointX}, ${pointY}) scale(${scale})`);
        }

        function getSVGPoint(e) {
            const pt = svg.createSVGPoint();
            // Handle touch or mouse
            pt.x = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
            pt.y = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;
            const ctm = svg.getScreenCTM();
            return ctm ? pt.matrixTransform(ctm.inverse()) : { x: pt.x, y: pt.y };
        }

        // Wheel Zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const mouseSVG = getSVGPoint(e);

            // Calculate mouse position relative to wrapper's current translation/scale
            const localX = (mouseSVG.x - pointX) / scale;
            const localY = (mouseSVG.y - pointY) / scale;

            const delta = -e.deltaY;
            if (delta > 0) scale *= 1.1;
            else scale /= 1.1;
            scale = Math.min(Math.max(0.5, scale), 8);

            // Adjust pointX/pointY so that local position stays under the mouse
            pointX = mouseSVG.x - localX * scale;
            pointY = mouseSVG.y - localY * scale;

            updateTransform();
        });

        // Mouse Pan
        container.addEventListener('mousedown', (e) => {
            if (e.target.closest('.zoom-controls') || e.target.closest('button')) return;
            isPanning = true;
            startPt = getSVGPoint(e);
            container.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            e.preventDefault();
            const currentPt = getSVGPoint(e);
            pointX += currentPt.x - startPt.x;
            pointY += currentPt.y - startPt.y;
            startPt = getSVGPoint(e); // Update reference point
            updateTransform();
        });

        window.addEventListener('mouseup', () => {
            isPanning = false;
            container.style.cursor = 'default';
        });

        // Touch Pan
        container.addEventListener('touchstart', (e) => {
            if (e.target.closest('.zoom-controls') || e.target.closest('button')) return;
            if (e.touches.length === 1) {
                isPanning = true;
                startPt = getSVGPoint(e.touches[0]);
            }
        }, { passive: false });

        container.addEventListener('touchmove', (e) => {
            if (isPanning && e.touches.length === 1) {
                e.preventDefault();
                const currentPt = getSVGPoint(e.touches[0]);
                pointX += currentPt.x - startPt.x;
                pointY += currentPt.y - startPt.y;
                startPt = getSVGPoint(e.touches[0]);
                updateTransform();
            }
        }, { passive: false });

        container.addEventListener('touchend', () => { isPanning = false; });

        svg.zoomIn = () => { scale *= 1.2; updateTransform(); };
        svg.zoomOut = () => { scale /= 1.2; updateTransform(); };

        function autoFitMap() {
            const containerRect = container.getBoundingClientRect();
            if (containerRect.width === 0) return;

            // Reset any previous modifications: The SVG itself is a 1000x1000 canvas.
            // SVG's default preserveAspectRatio="xMidYMid meet" will center this 1000x1000 block.
            svg.setAttribute('viewBox', '0 0 1000 1000');

            const box = wrapper.getBBox();
            if (box.width === 0 || box.height === 0) {
                setTimeout(autoFitMap, 50);
                return;
            }

            // Calculate how the browser scaled the 1000x1000 logical grid onto the screen
            const W = containerRect.width;
            const H = containerRect.height;
            const S = Math.min(W / 1000, H / 1000);
            if (S === 0) return;

            // Target physical padding inside the container
            const paddingPhysical = 20;

            // Calculate inner SVG mathematical zoom needed to fill the screen
            const scaleX = (W - paddingPhysical * 2) / (box.width * S);
            const scaleY = (H - paddingPhysical * 2) / (box.height * S);

            scale = Math.min(scaleX, scaleY);
            scale = Math.min(Math.max(0.2, scale), 8);

            const boxCenterX = box.x + box.width / 2;
            const boxCenterY = box.y + box.height / 2;

            // The exact center point of the viewable screen is always exactly (500, 500) 
            // inside the unscaled 1000x1000 SVG viewbox because of xMidYMid meet centering.
            pointX = 500 - (boxCenterX * scale);
            pointY = 500 - (boxCenterY * scale);

            updateTransform();
        }

        svg.resetZoom = autoFitMap;

        // Auto-fit on load
        setTimeout(autoFitMap, 50);

        // Auto-fit on window resize
        window.addEventListener('resize', autoFitMap);
    }

    function bindZoomButtons() {
        zoomInBtn = document.getElementById('zoomIn');
        zoomOutBtn = document.getElementById('zoomOut');
        zoomResetBtn = document.getElementById('zoomReset');
        const svg = mapContainer.querySelector('svg');
        if (!svg) return;

        if (zoomInBtn) zoomInBtn.onclick = (e) => { e.stopPropagation(); svg.zoomIn && svg.zoomIn(); };
        if (zoomOutBtn) zoomOutBtn.onclick = (e) => { e.stopPropagation(); svg.zoomOut && svg.zoomOut(); };
        if (zoomResetBtn) zoomResetBtn.onclick = (e) => { e.stopPropagation(); svg.resetZoom && svg.resetZoom(); };
    }

    // --- Interactions ---
    function handleMapClick(e, element) {
        if (state.isLocked) return;
        const code = parseInt(element.getAttribute('data-code'), 10);

        if (state.gameMode === 'memorize') {
            // Briefly flash the map element to show it's selected
            element.classList.add('memorize-highlight');
            setTimeout(() => element.classList.remove('memorize-highlight'), 1500);

            // Scroll the list to the selected item for better UX
            const listEl = document.querySelector(`.list-item[data-id="${code}"]`);
            if (listEl) {
                listEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            showInfo(code);
            return;
        }

        // Quiz Mode
        if (state.cleared.has(code)) {
            showInfo(code);
            return;
        }

        if (state.selectedMapId === code) {
            deselectMap();
        } else {
            deselectMap();
            state.selectedMapId = code;
            element.classList.add('selected');
            checkMatch();
        }
    }

    function deselectMap() {
        if (state.selectedMapId) {
            const prev = document.querySelector(`.prefecture[data-code="${state.selectedMapId}"]`);
            if (prev) prev.classList.remove('selected');
            state.selectedMapId = null;
        }
    }

    // --- List Handling ---
    function renderList() {
        prefectureList.innerHTML = '';
        const sortedData = [...prefectureData].sort((a, b) => a.id - b.id);
        sortedData.forEach(pref => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = pref.id;

            if (state.gameMode === 'memorize') {
                // In Memorize mode, show both name and capital
                li.innerHTML = `<span style="font-weight:bold;">${pref.name}</span><span style="font-size:0.85em; margin-left:8px; opacity:0.8;">(${pref.capital})</span>`;
            } else {
                if (state.cleared.has(pref.id)) li.classList.add('cleared');
                // Text depends on mode
                li.textContent = state.gameMode === 'quiz_pref' ? pref.name : pref.capital;
            }

            li.addEventListener('click', () => handleListClick(li, pref.id));
            prefectureList.appendChild(li);
        });
        updateProgress();
    }

    function handleListClick(element, id) {
        if (state.isLocked) return;

        if (state.gameMode === 'memorize') {
            // Highlight map and show modal
            const mapEl = document.querySelector(`.prefecture[data-code="${id}"]`);
            if (mapEl) {
                // Briefly flash the map element to show it's selected
                mapEl.classList.add('memorize-highlight');
                setTimeout(() => mapEl.classList.remove('memorize-highlight'), 1500);
            }
            showInfo(id);
            return;
        }

        // Quiz Logic
        if (state.cleared.has(id)) return;

        if (state.selectedListId === id) {
            deselectList();
        } else {
            deselectList();
            state.selectedListId = id;
            element.classList.add('selected');
            checkMatch();
        }
    }

    function deselectList() {
        if (state.selectedListId) {
            const prev = document.querySelector(`.list-item[data-id="${state.selectedListId}"]`);
            if (prev) prev.classList.remove('selected');
            state.selectedListId = null;
        }
    }

    // --- Match Logic ---
    function checkMatch() {
        if (state.selectedMapId && state.selectedListId) {
            if (state.selectedMapId === state.selectedListId) {
                handleCorrect(state.selectedMapId);
            } else {
                handleWrong();
            }
        }
    }

    function handleCorrect(id) {
        state.isLocked = true;
        state.cleared.add(id);
        updateVisualsCleared(id);
        deselectMap();
        deselectList();
        setTimeout(() => {
            showInfo(id);
            state.isLocked = false;
        }, 300);
    }

    function handleWrong() {
        state.isLocked = true;
        const mapEl = document.querySelector(`.prefecture[data-code="${state.selectedMapId}"]`);
        const listEl = document.querySelector(`.list-item[data-id="${state.selectedListId}"]`);
        if (mapEl) mapEl.classList.add('shake');
        if (listEl) listEl.classList.add('shake');
        setTimeout(() => {
            if (mapEl) mapEl.classList.remove('shake');
            if (listEl) listEl.classList.remove('shake');
            deselectMap();
            deselectList();
            state.isLocked = false;
        }, 500);
    }

    function updateVisualsCleared(id) {
        const mapEl = document.querySelector(`.prefecture[data-code="${id}"]`);
        if (mapEl) {
            mapEl.classList.add('cleared');
            mapEl.classList.remove('selected');
        }
        const listEl = document.querySelector(`.list-item[data-id="${id}"]`);
        if (listEl) {
            listEl.classList.add('cleared');
            listEl.classList.remove('selected');
        }
        updateProgress();

        if (state.cleared.size === 47) {
            setTimeout(() => {
                alert("🎉全問正解！おめでとうございます！\n最初からやり直します。");
                resetGameState();
            }, 500);
        }
    }

    // --- UI/Modal ---
    function showInfo(id) {
        const data = prefectureData.find(p => p.id === id);
        if (!data) return;
        document.getElementById('infoName').textContent = data.name;
        document.getElementById('infoCapital').innerHTML = `県庁所在地: <span>${data.capital}</span>`;
        document.getElementById('infoRegion').textContent = data.region;
        document.getElementById('infoNeighbors').textContent = data.neighbors.join(', ');
        document.getElementById('infoSpecialties').textContent = data.specialties.join('、');
        document.getElementById('infoRelation').textContent = data.relation;
        openModal(infoModal);
    }

    function updateProgress() {
        if (progressCount) progressCount.textContent = state.cleared.size;
    }

    function openModal(modal) {
        if (modal) modal.classList.remove('hidden');
    }
    function closeModal(modal) {
        if (!modal) modal = infoModal;
        if (modal) modal.classList.add('hidden');
    }

    function resetGameState() {
        state.isLocked = false;
        deselectMap();
        deselectList();
        state.cleared.clear();
        document.querySelectorAll('.prefecture').forEach(el => {
            el.classList.remove('cleared', 'selected', 'memorize-highlight', 'shake');
        });
        renderList();
        updateProgress();
    }

    // --- Mode Switching ---
    function updateGameMode() {
        if (!gameModeSelect) return;
        const mainContainer = document.querySelector('.main-container');

        // Always show the list section now for both modes
        if (listSection) listSection.style.display = 'flex';

        resetGameState();

        if (state.gameMode === 'memorize') {
            document.title = "都道府県マスター - 暗記モード";
            if (mainContainer) mainContainer.classList.add('mode-memorize');
            // Optionally hide progress count in memorize mode
            if (progressCount) progressCount.style.display = 'none';

        } else {
            document.title = "都道府県クイズ";
            if (mainContainer) mainContainer.classList.remove('mode-memorize');
            if (progressCount) progressCount.style.display = 'block';
        }
    }

    // --- Listeners ---

    // --- Listeners ---
    function setupEventListeners() {
        if (themeToggle) {
            themeToggle.onclick = () => {
                const current = document.documentElement.getAttribute('data-theme');
                const next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('theme', next);
                themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
            };
        }

        if (gameModeSelect) {
            gameModeSelect.onchange = (e) => {
                state.gameMode = e.target.value;
                updateGameMode();
            };
        }

        // modeToggle is fully replaced by unified gameModeSelect

        // Modal Closing
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.onclick = () => closeModal(infoModal);
        });
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) nextBtn.onclick = () => closeModal(infoModal);

        window.onclick = (e) => {
            if (e.target === infoModal) closeModal(infoModal);
        };
    }
});
