// Global variable to store the current user's role
let currentUserRole = 'viewer';

// Function to toggle dark mode
function toggleDarkMode() {
    const html = document.documentElement;
    const btn = document.getElementById('darkModeToggle');
    html.classList.toggle('dark');
    const isDark = html.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (btn) {
        btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    }
}

// Function to initialize theme on page load
function initTheme() {
    const html = document.documentElement;
    const btn = document.getElementById('darkModeToggle');
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        html.classList.add('dark');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        html.classList.remove('dark');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
}

// Function to fetch user role and adjust UI
async function fetchUserRole() {
    try {
        const res = await axios.get('/api/me');
        currentUserRole = res.data.role;

        // Re-render any dynamic tables/buttons that depend on role
        // Call page-specific main rendering functions if they exist
        if (typeof loadMembers === 'function') loadMembers(); // For index.html
        if (typeof loadFollowUps === 'function') loadFollowUps(); // For follow-up.html
        if (typeof loadMasterData === 'function') loadMasterData(); // For dashboard.html
        if (typeof loadAttendance === 'function') loadAttendance(); // For attendance.html
        if (typeof loadUsers === 'function') loadUsers(); // For users.html
        if (typeof loadStats === 'function') loadStats(); // For attendance.html and dashboard.html

        // Hide/show add forms/buttons for viewers
        if (currentUserRole === 'viewer') {
            document.querySelectorAll('form, .submit-btn, .action-btn, .delete, .edit, .checkout').forEach(el => {
                if (el.tagName === 'BUTTON' || el.tagName === 'FORM' || el.classList.contains('submit-btn') || el.classList.contains('action-btn') || el.classList.contains('delete') || el.classList.contains('edit') || el.classList.contains('checkout')) {
                    el.style.display = 'none';
                }
            });
        }
    } catch (err) {
        console.error('Role fetch failed:', err);
        // If fetching role fails (e.g., not authenticated), redirect to login
        if (err.response && err.response.status === 401) {
            window.location.href = '/login.html';
        }
    }
}

// Call after page loads
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchUserRole();
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered:', reg))
            .catch(err => console.log('SW registration failed:', err));
    });
}

// Optional: Show install prompt (for browsers that support it)
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show a custom install button (optional)
    const installBtn = document.createElement('button');
    installBtn.textContent = '📲 Install App';
    installBtn.style.position = 'fixed';
    installBtn.style.bottom = '20px';
    installBtn.style.right = '20px';
    installBtn.style.backgroundColor = '#10b981';
    installBtn.style.color = 'white';
    installBtn.style.border = 'none';
    installBtn.style.padding = '10px 20px';
    installBtn.style.borderRadius = '50px';
    installBtn.style.zIndex = '9999';
    installBtn.style.cursor = 'pointer';
    installBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    installBtn.onclick = () => {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(choice => {
            if (choice.outcome === 'accepted') console.log('User accepted install');
            deferredPrompt = null;
            installBtn.remove();
        });
    };
    document.body.appendChild(installBtn);
});

// Highlight active navigation link
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.href === window.location.href) {
            link.classList.add('bg-emerald-100', 'text-emerald-700', 'dark:bg-emerald-900/50', 'dark:text-emerald-300');
            link.classList.remove('hover:bg-gray-100');
        }
    });
});