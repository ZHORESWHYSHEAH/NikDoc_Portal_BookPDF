// main.js - User Library browser & Elite 3D Page-Flip Book Viewer

document.addEventListener('DOMContentLoaded', function() {
    initSearch();
    initViewerControls();
});

// Get global user access token
function getUserToken() {
    return document.getElementById('user-token-global').value;
}

// ----------------------------------------------------
// SEARCH FILTERING
// ----------------------------------------------------
function initSearch() {
    const searchInput = document.getElementById('lib-search');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        const items = document.querySelectorAll('#library-grid .file-item');
        
        items.forEach(item => {
            const nameEl = item.querySelector('.file-name');
            if (nameEl) {
                const name = nameEl.innerText.toLowerCase();
                if (name.includes(query)) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            }
        });
    });
}

// ----------------------------------------------------
// PDF.JS 3D FLIPBOOK VIEWER INTEGRATION
// ----------------------------------------------------
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfDoc = null,
    pageNum = 1, // Always represents the current Left page (except page 1 which is cover on right)
    pageRendering = false,
    scale = 1.0,
    activeDocId = null;

// Book View canvases
const canvasLeft = document.getElementById('pdf-canvas-left');
const canvasRight = document.getElementById('pdf-canvas-right');
const canvasFlipFront = document.getElementById('pdf-canvas-flip-front');
const canvasFlipBack = document.getElementById('pdf-canvas-flip-back');
const flipWrapper = document.getElementById('flipping-page-wrapper');

function initViewerControls() {
    if (!canvasLeft) return;
    
    // Page navigation buttons
    document.getElementById('prev-page-btn').addEventListener('click', onPrevPage);
    document.getElementById('next-page-btn').addEventListener('click', onNextPage);
    
    // Current page manual number input box
    document.getElementById('curr-page-input').addEventListener('change', function() {
        const val = parseInt(this.value);
        if (pdfDoc && val >= 1 && val <= pdfDoc.numPages) {
            // Group to even number or 1
            const targetPage = val === 1 ? 1 : (val % 2 === 0 ? val : val - 1);
            renderBookPages(targetPage);
        } else if (pdfDoc) {
            this.value = pageNum;
        }
    });
    
    // Zoom control buttons
    document.getElementById('zoom-in-btn').addEventListener('click', () => {
        zoom(1.2);
    });
    
    document.getElementById('zoom-out-btn').addEventListener('click', () => {
        zoom(0.8);
    });
    
    document.getElementById('zoom-fit-btn').addEventListener('click', () => {
        fitToWidth();
    });
    
    // Download action
    document.getElementById('download-doc-btn').addEventListener('click', function() {
        if (activeDocId) {
            window.location.href = `document?token=${getUserToken()}&id=${activeDocId}&download=1`;
        }
    });
    
    // Keyboard listeners for navigation
    window.addEventListener('keydown', function(e) {
        const modal = document.getElementById('pdf-reader-modal');
        if (modal && modal.style.display === 'flex') {
            if (e.key === 'ArrowLeft') {
                onPrevPage();
            } else if (e.key === 'ArrowRight') {
                onNextPage();
            } else if (e.key === 'Escape') {
                closePdfReader();
            }
        }
    });
    
    // Redraw pages on window resize to ensure responsiveness
    window.addEventListener('resize', function() {
        const modal = document.getElementById('pdf-reader-modal');
        if (modal && modal.style.display === 'flex') {
            fitToWidth();
        }
    });
}

function openPdfReader(docId, docName) {
    activeDocId = docId;
    pageNum = 1;
    scale = 1.0;
    
    document.getElementById('reader-doc-title').innerText = docName;
    const modal = document.getElementById('pdf-reader-modal');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Lock body scroll
    
    // Show spinner & clear error alert
    document.getElementById('reader-loading-spinner').style.display = 'block';
    document.getElementById('reader-error-alert').style.display = 'none';
    document.getElementById('book-wrapper').style.opacity = '0';
    
    // Generate secure URL path to stream file
    const url = `document?token=${getUserToken()}&id=${docId}`;
    
    // Load document using PDF.js
    pdfjsLib.getDocument(url).promise.then(function(pdfDoc_) {
        pdfDoc = pdfDoc_;
        document.getElementById('total-pages-label').innerText = pdfDoc.numPages;
        document.getElementById('curr-page-input').max = pdfDoc.numPages;
        
        // Hide loader
        document.getElementById('reader-loading-spinner').style.display = 'none';
        document.getElementById('book-wrapper').style.opacity = '1';
        
        // Fit width initially on opening
        fitToWidth();
    }).catch(function(error) {
        document.getElementById('reader-loading-spinner').style.display = 'none';
        const errAlert = document.getElementById('reader-error-alert');
        errAlert.style.display = 'block';
        document.getElementById('reader-error-msg').innerText = 'Could not stream PDF file: ' + error.message;
    });
}

/**
 * Render single page on a target canvas
 */
function renderPageOnCanvas(num, targetCanvas) {
    return new Promise((resolve, reject) => {
        if (!pdfDoc || num < 1 || num > pdfDoc.numPages) {
            clearCanvas(targetCanvas);
            resolve();
            return;
        }
        
        pdfDoc.getPage(num).then(function(page) {
            const viewport = page.getViewport({ scale: scale });
            targetCanvas.height = viewport.height;
            targetCanvas.width = viewport.width;
            
            const ctx = targetCanvas.getContext('2d');
            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            
            page.render(renderContext).promise.then(() => {
                resolve();
            }).catch(reject);
        }).catch(reject);
    });
}

function clearCanvas(targetCanvas) {
    if (!targetCanvas) return;
    const ctx = targetCanvas.getContext('2d');
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCanvas.width = 0;
    targetCanvas.height = 0;
}

/**
 * Render the side-by-side book view
 */
function renderBookPages(num) {
    if (pageRendering) return;
    pageRendering = true;
    
    const isMobile = window.innerWidth <= 768;
    
    // Update numeric page input value
    document.getElementById('curr-page-input').value = num;
    pageNum = num;
    
    if (isMobile) {
        // Mobile view: Render single page on Left canvas, hide Right
        canvasRight.style.display = 'none';
        clearCanvas(canvasRight);
        
        renderPageOnCanvas(num, canvasLeft).then(() => {
            pageRendering = false;
        }).catch(() => {
            pageRendering = false;
        });
    } else {
        // Desktop View:
        canvasRight.style.display = 'block';
        
        if (num === 1) {
            // Page 1 is cover (shows on right side, left is empty)
            clearCanvas(canvasLeft);
            renderPageOnCanvas(1, canvasRight).then(() => {
                pageRendering = false;
            }).catch(() => {
                pageRendering = false;
            });
        } else {
            // Render left page (num) and right page (num+1)
            const p1 = renderPageOnCanvas(num, canvasLeft);
            const p2 = (num + 1 <= pdfDoc.numPages) 
                ? renderPageOnCanvas(num + 1, canvasRight) 
                : Promise.resolve();
                
            Promise.all([p1, p2]).then(() => {
                pageRendering = false;
            }).catch(() => {
                pageRendering = false;
            });
        }
    }
}

/**
 * Executing hardware-accelerated 3D Page Flip animation transitions
 */
function executePageFlipAnimation(nextPage, direction) {
    if (pageRendering) return;
    
    const isMobile = window.innerWidth <= 768;
    // Mobile view doesn't support 3D side-by-side page flips - do direct redraw
    if (isMobile || !flipWrapper) {
        renderBookPages(nextPage);
        return;
    }
    
    pageRendering = true;
    
    const currentPage = pageNum;
    
    if (direction === 'forward') {
        // Forward: current right page (front face) turns to new left page (back face)
        const frontPage = currentPage === 1 ? 1 : currentPage + 1;
        const backPage = nextPage; // The new left page
        
        const renderFlipFront = renderPageOnCanvas(frontPage, canvasFlipFront);
        const renderFlipBack = renderPageOnCanvas(backPage, canvasFlipBack);
        
        Promise.all([renderFlipFront, renderFlipBack]).then(() => {
            // Adjust dimensions of flip card wrapper to match canvases
            flipWrapper.style.width = canvasRight.clientWidth + 'px';
            flipWrapper.style.height = canvasRight.clientHeight + 'px';
            
            // Set 3D Hinge Origin to LEFT of right page (center spine)
            flipWrapper.style.left = '50%';
            flipWrapper.style.transformOrigin = 'left center';
            
            // Start flat on right side
            flipWrapper.style.transform = 'rotateY(0deg)';
            flipWrapper.style.display = 'block';
            
            // Render the underlying background targets to prevent visual gap during animation
            // Left becomes new left page (nextPage), Right becomes the next right page (nextPage + 1)
            const renderUnderneathRight = (nextPage + 1 <= pdfDoc.numPages)
                ? renderPageOnCanvas(nextPage + 1, canvasRight)
                : Promise.resolve();
                
            renderUnderneathRight.then(() => {
                // Set the current left page to the new left page underneath (revealed by turn)
                renderPageOnCanvas(nextPage, canvasLeft);
                
                // Force a layout reflow/repaint so browser records start transform state
                flipWrapper.offsetHeight;
                
                // Transition turn to left side (-180deg)
                flipWrapper.style.transform = 'rotateY(-180deg)';
                
                // Wait for transition to finish (600ms matching transition in style.css)
                setTimeout(() => {
                    flipWrapper.style.display = 'none';
                    flipWrapper.style.transform = '';
                    pageRendering = false;
                    renderBookPages(nextPage);
                }, 600);
            });
        });
        
    } else {
        // Backward: current left page (front face) turns back to new right page (back face)
        const frontPage = currentPage; // Current left page (Page N)
        const backPage = nextPage + 1; // New right page (Page N-1)
        
        const renderFlipFront = renderPageOnCanvas(frontPage, canvasFlipFront);
        const renderFlipBack = renderPageOnCanvas(backPage, canvasFlipBack);
        
        Promise.all([renderFlipFront, renderFlipBack]).then(() => {
            // Setup flipcard wrapper dimension to match left canvas
            flipWrapper.style.width = canvasLeft.clientWidth + 'px';
            flipWrapper.style.height = canvasLeft.clientHeight + 'px';
            
            // Set 3D Hinge Origin to RIGHT of left page (center spine)
            flipWrapper.style.left = '0%';
            flipWrapper.style.transformOrigin = 'right center';
            
            // Start flat on left side
            flipWrapper.style.transform = 'rotateY(0deg)';
            flipWrapper.style.display = 'block';
            
            // Set underneath left canvas to new left page (nextPage)
            const renderUnderneathLeft = renderPageOnCanvas(nextPage, canvasLeft);
            
            renderUnderneathLeft.then(() => {
                // Set right canvas to new right page (revealed underneath)
                renderPageOnCanvas(nextPage + 1, canvasRight);
                
                // Force layout reflow/repaint
                flipWrapper.offsetHeight;
                
                // Rotate to right side (180deg)
                flipWrapper.style.transform = 'rotateY(180deg)';
                
                setTimeout(() => {
                    flipWrapper.style.display = 'none';
                    flipWrapper.style.transform = '';
                    pageRendering = false;
                    renderBookPages(nextPage);
                }, 600);
            });
        });
    }
}

function onPrevPage() {
    if (!pdfDoc || pageRendering) return;
    
    let prev;
    if (pageNum === 2) {
        prev = 1;
    } else if (pageNum > 2) {
        prev = pageNum - 2;
    } else {
        return; // cover page boundary check
    }
    
    executePageFlipAnimation(prev, 'backward');
}

function onNextPage() {
    if (!pdfDoc || pageRendering) return;
    
    let next;
    if (pageNum === 1) {
        next = 2;
    } else if (pageNum + 2 <= pdfDoc.numPages) {
        next = pageNum + 2;
    } else {
        return; // end page boundary check
    }
    
    executePageFlipAnimation(next, 'forward');
}

function zoom(factor) {
    if (!pdfDoc || pageRendering) return;
    scale = scale * factor;
    renderBookPages(pageNum);
}

function fitToWidth() {
    if (!pdfDoc || pageRendering) return;
    
    // Fit to scroll view container width
    pdfDoc.getPage(pageNum).then(function(page) {
        const viewport = page.getViewport({ scale: 1.0 });
        const scrollContainer = document.getElementById('reader-scroll-container');
        const isMobile = window.innerWidth <= 768;
        
        let containerWidth = scrollContainer.clientWidth - 60;
        if (!isMobile) {
            containerWidth = containerWidth / 2; // Split width across left/right pages
        }
        
        scale = containerWidth / viewport.width;
        renderBookPages(pageNum);
    });
}

function closePdfReader() {
    const modal = document.getElementById('pdf-reader-modal');
    modal.style.display = 'none';
    document.body.style.overflow = ''; // Unlock body scroll
    
    // Reset state variables
    pdfDoc = null;
    pageNum = 1;
    pageRendering = false;
    activeDocId = null;
    
    // Clear canvases
    clearCanvas(canvasLeft);
    clearCanvas(canvasRight);
    clearCanvas(canvasFlipFront);
    clearCanvas(canvasFlipBack);
    if (flipWrapper) flipWrapper.style.display = 'none';
}
