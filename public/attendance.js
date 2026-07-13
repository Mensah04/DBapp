// Configuration
const API_URL = 'http://localhost:3000/api/attendance';
let currentPage = 1;
let currentFilters = {};
let currentSearch = '';
let checkoutId = null;

// DOM Elements
const attendanceForm = document.getElementById('attendanceForm');
const attendanceTable = document.getElementById('attendanceTable').getElementsByTagName('tbody')[0];
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const serviceTypeFilter = document.getElementById('serviceTypeFilter');
const statusFilter = document.getElementById('statusFilter');
const dateFilter = document.getElementById('dateFilter');
const applyFilters = document.getElementById('applyFilters');
const resetFilters = document.getElementById('resetFilters');
const exportBtn = document.getElementById('exportBtn');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const paginationInfo = document.getElementById('paginationInfo');
const checkoutModal = document.getElementById('checkoutModal');
const checkoutName = document.getElementById('checkoutName');
const confirmCheckout = document.getElementById('confirmCheckout');
const cancelCheckout = document.getElementById('cancelCheckout');
const closeModal = document.querySelector('.close-modal');

// Statistics elements
const todayTotal = document.getElementById('todayTotal');
const childrenCount = document.getElementById('childrenCount');
const youthCount = document.getElementById('youthCount');
const marriedCount = document.getElementById('marriedCount');
const singleCount = document.getElementById('singleCount');
const maleCount      = document.getElementById('maleCount');
const femaleCount    = document.getElementById('femaleCount');

// Set today's date by default
const today = new Date().toISOString().split('T')[0];
document.getElementById('attendanceDate').value = today;
dateFilter.value = today;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAttendance();
    loadStatistics();
    setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
    attendanceForm.addEventListener('submit', handleCheckIn);
    searchInput.addEventListener('input', debounce(handleSearch, 300));
    applyFilters.addEventListener('click', applyFiltersHandler);
    resetFilters.addEventListener('click', resetFiltersHandler);
    exportBtn.addEventListener('click', exportData);
    prevPage.addEventListener('click', () => changePage(-1));
    nextPage.addEventListener('click', () => changePage(1));
    
    // Modal events
    confirmCheckout.addEventListener('click', handleCheckout);
    cancelCheckout.addEventListener('click', () => checkoutModal.style.display = 'none');
    closeModal.addEventListener('click', () => checkoutModal.style.display = 'none');
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === checkoutModal) {
            checkoutModal.style.display = 'none';
        }
    });
}

// Utility: Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Handle Check-in
async function handleCheckIn(e) {
    e.preventDefault();
    
    const attendanceData = {
        name: document.getElementById('attendanceName').value.trim(),
        category: document.getElementById('attendanceCategory').value,
        gender: document.getElementById('attendanceGender').value || undefined,  // ← fixed: use select id
        phone: document.getElementById('attendancePhone').value.trim(),
        serviceType: document.getElementById('attendanceService').value,
        date: document.getElementById('attendanceDate').value 
            ? new Date(document.getElementById('attendanceDate').value + 'T00:00:00') 
            : new Date(),
        notes: document.getElementById('attendanceNotes').value.trim()
    };

    console.log('Prepared data:', attendanceData);  // ← debug: see what is sent

    // Validation – now checks gender too
    if (!attendanceData.name || 
        !attendanceData.category || 
        !attendanceData.gender || 
        !attendanceData.serviceType) {
        alert('Please fill in all required fields (*)');
        return;
    }

    try {
        console.log('Sending to:', API_URL);
        const response = await axios.post(API_URL, attendanceData);
        console.log('Success response:', response.data);
        
        showNotification('✅ Successfully checked in!', 'success');
        
        // Reset form
        attendanceForm.reset();
        document.getElementById('attendanceDate').value = today;
        document.getElementById('attendanceService').value = '';
        document.getElementById('attendanceGender').value = ''; // reset gender too
        
        // Reload data
        loadAttendance();
        loadStatistics();
        
    } catch (error) {
        console.error('Check-in error:', error);

        let userMessage = 'Check-in failed – please try again';

        if (error.response) {
            console.log('Status:', error.response.status);
            console.log('Response data:', error.response.data);
            
            if (error.response.status === 409) {
                userMessage = error.response.data.message || 
                             'This phone number has already been checked in today for this service!';
            } else if (error.response.data?.message) {
                userMessage = error.response.data.message;
            }
        } else if (error.request) {
            userMessage = 'No response from server – is backend running?';
        }

        showNotification(`❌ ${userMessage}`, 'error');
    }
}

// Load Attendance Data
async function loadAttendance() {
    try {
        const params = new URLSearchParams({
            page: currentPage,
            limit: 20,
            ...currentFilters
        });

        if (currentSearch) {
            params.delete('page');
            params.delete('limit');
            // Use search endpoint for search queries
            const response = await axios.get(`${API_URL}/search/${encodeURIComponent(currentSearch)}`);
            displayAttendance(response.data);
            updatePaginationInfo(response.data.length, 1);
            return;
        }

        const response = await axios.get(`${API_URL}?${params}`);
        const { attendance, pagination } = response.data;
        
        displayAttendance(attendance);
        updatePaginationInfo(pagination.total, pagination.page, pagination.pages);
        
    } catch (error) {
        console.error('Error loading attendance:', error);
        showNotification('❌ Failed to load attendance data', 'error');
    }
}

// Display Attendance in Table
function displayAttendance(data) {
    attendanceTable.innerHTML = '';
    
    if (data.length === 0) {
        const row = attendanceTable.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 9;
        cell.textContent = 'No attendance records found';
        cell.style.textAlign = 'center';
        cell.style.padding = '2rem';
        cell.style.color = '#95a5a6';
        return;
    }

    data.forEach(record => {
        const row = attendanceTable.insertRow();
        row.style.cursor = 'pointer'; // visual hint it's clickable
        row.onclick = () => openMemberModal(record._id); // ← new: open modal on click

        // Name
        const nameCell = row.insertCell();
        nameCell.textContent = record.name;

        // Category
        const categoryCell = row.insertCell();
        const categoryBadge = document.createElement('span');
        categoryBadge.className = `category-badge ${record.category.toLowerCase()}`;
        categoryBadge.textContent = record.category;
        categoryCell.appendChild(categoryBadge);

        // Gender
        const genderCell = row.insertCell();
        genderCell.textContent = record.gender || '-';

        // Phone
        const phoneCell = row.insertCell();
        phoneCell.textContent = record.phone || '-';

        // Service
        const serviceCell = row.insertCell();
        serviceCell.textContent = record.serviceType;

        // Date
        const dateCell = row.insertCell();
        const date = new Date(record.date);
        dateCell.textContent = date.toLocaleDateString();

        // Check-in Time
        const checkinCell = row.insertCell();
        const checkinTime = new Date(record.checkedInTime);
        checkinCell.textContent = checkinTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        // Status
        const statusCell = row.insertCell();
        const statusBadge = document.createElement('span');
        statusBadge.className = `status-badge ${record.checkedIn ? 'checked-in' : 'checked-out'}`;
        statusBadge.textContent = record.checkedIn ? 'Checked In' : 'Checked Out';
        statusCell.appendChild(statusBadge);

        // Actions (keep your existing buttons)
        const actionsCell = row.insertCell();
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'action-buttons';

        if (record.checkedIn) {
            const checkoutBtn = document.createElement('button');
            checkoutBtn.className = 'action-btn checkout';
            checkoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Check Out';
            checkoutBtn.onclick = (e) => {
                e.stopPropagation(); // prevent row click
                openCheckoutModal(record._id, record.name);
            };
            actionsDiv.appendChild(checkoutBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit';
        editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            editAttendance(record._id);
        };
        actionsDiv.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn delete';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteAttendance(record._id, record.name);
        };
        actionsDiv.appendChild(deleteBtn);

        actionsCell.appendChild(actionsDiv);
    });
}
// Load Statistics
async function loadStatistics() {
    try {
        const response = await axios.get(`${API_URL}/stats`);
        const { today, overall } = response.data;
        
        // Update today's stats
        todayTotal.querySelector('.stat-number').textContent = today.total;
        childrenCount.querySelector('.stat-number').textContent = today.byCategory.Children || 0;
        youthCount.querySelector('.stat-number').textContent = today.byCategory.Youth || 0;
        marriedCount.querySelector('.stat-number').textContent = today.byCategory.Married || 0;
        singleCount.querySelector('.stat-number').textContent = today.byCategory.Single || 0;
        maleCount.querySelector('.stat-number').textContent = today.byGender?.Male || 0;
        femaleCount.querySelector('.stat-number').textContent = today.byGender?.Female || 0;
        
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// Handle Search
async function handleSearch(e) {
    currentSearch = e.target.value.trim();
    currentPage = 1;
    loadAttendance();
}

// Apply Filters
function applyFiltersHandler() {
    currentFilters = {};
    
    if (categoryFilter.value) currentFilters.category = categoryFilter.value;
    if (serviceTypeFilter.value) currentFilters.serviceType = serviceTypeFilter.value;
    if (statusFilter.value) currentFilters.checkedIn = statusFilter.value;
    if (dateFilter.value) currentFilters.date = dateFilter.value;
    
    currentPage = 1;
    loadAttendance();
}

// Reset Filters
function resetFiltersHandler() {
    categoryFilter.value = '';
    serviceTypeFilter.value = '';
    statusFilter.value = '';
    dateFilter.value = today;
    searchInput.value = '';
    
    currentFilters = {};
    currentSearch = '';
    currentPage = 1;
    
    loadAttendance();
}

// Export Data
async function exportData() {
    try {
        const params = new URLSearchParams(currentFilters);
        if (dateFilter.value && dateFilter.value !== today) {
            params.set('date', dateFilter.value);
        }
        
        const url = `${API_URL}/export/csv?${params}`;
        window.open(url, '_blank');
        
    } catch (error) {
        console.error('Export error:', error);
        showNotification('❌ Failed to export data', 'error');
    }
}

// Change Page
function changePage(delta) {
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    loadAttendance();
}

// Update Pagination Info
function updatePaginationInfo(total, page, totalPages) {
    paginationInfo.textContent = `Showing ${total} record${total !== 1 ? 's' : ''}`;
    pageInfo.textContent = `Page ${page}${totalPages ? ` of ${totalPages}` : ''}`;
    
    prevPage.disabled = page <= 1;
    nextPage.disabled = totalPages ? page >= totalPages : true;
}

// Open Checkout Modal
function openCheckoutModal(id, name) {
    checkoutId = id;
    checkoutName.textContent = name;
    checkoutModal.style.display = 'flex';
}

// Handle Checkout
async function handleCheckout() {
    if (!checkoutId) return;
    
    try {
        await axios.put(`${API_URL}/${checkoutId}`, { checkedOut: true });
        showNotification('✅ Successfully checked out!', 'success');
        checkoutModal.style.display = 'none';
        loadAttendance();
        loadStatistics();
    } catch (error) {
        console.error('Checkout error:', error);
        showNotification('❌ Failed to check out', 'error');
    }
}

// Edit Attendance
async function editAttendance(id) {
    try {
        const response = await axios.get(`${API_URL}/${id}`);
        const record = response.data;
        
        // Populate form with existing data
        document.getElementById('attendanceName').value = record.name;
        document.getElementById('attendanceCategory').value = record.category;
        document.getElementById('attendanceGender').value = record.gender || '';
        document.getElementById('attendancePhone').value = record.phone || '';
        document.getElementById('attendanceService').value = record.serviceType;
        document.getElementById('attendanceDate').value = new Date(record.date).toISOString().split('T')[0];
        document.getElementById('attendanceNotes').value = record.notes || '';
        
        // Scroll to form
        document.querySelector('.quick-checkin').scrollIntoView({ behavior: 'smooth' });
        
        // Change form submit to update instead of create
        attendanceForm.onsubmit = async (e) => {
            e.preventDefault();
            await updateAttendance(id);
        };
        
        // Change button text
        const submitBtn = attendanceForm.querySelector('.submit-btn');
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Record';
        
    } catch (error) {
        console.error('Error loading record for edit:', error);
        showNotification('❌ Failed to load record', 'error');
    }
}

// Update Attendance
async function updateAttendance(id) {
    const attendanceData = {
        name: document.getElementById('attendanceName').value.trim(),
        category: document.getElementById('attendanceCategory').value,
        gender: document.getElementById('attendanceGender').value,
        phone: document.getElementById('attendancePhone').value.trim(),
        serviceType: document.getElementById('attendanceService').value,
        date: document.getElementById('attendanceDate').value 
        ? new Date(document.getElementById('attendanceDate').value + 'T00:00:00') 
        : new Date(),
        notes: document.getElementById('attendanceNotes').value.trim()
    };

    try {
        await axios.put(`${API_URL}/${id}`, attendanceData);
        showNotification('✅ Record updated successfully!', 'success');
        
        // Reset form
        attendanceForm.reset();
        document.getElementById('attendanceDate').value = today;
        document.getElementById('attendanceService').value = 'Sunday Service';
        
        // Restore original submit handler
        attendanceForm.onsubmit = handleCheckIn;
        const submitBtn = attendanceForm.querySelector('.submit-btn');
        submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> Check In';
        
        // Reload data
        loadAttendance();
        loadStatistics();
        
    } catch (error) {
        console.error('Update error:', error);
        showNotification(`❌ Error: ${error.response?.data?.message || 'Update failed'}`, 'error');
    }
}

// Delete Attendance
async function deleteAttendance(id, name) {
    if (!confirm(`Are you sure you want to delete attendance record for ${name}?`)) {
        return;
    }
    
    try {
        await axios.delete(`${API_URL}/${id}`);
        showNotification('✅ Record deleted successfully!', 'success');
        loadAttendance();
        loadStatistics();
    } catch (error) {
        console.error('Delete error:', error);
        showNotification('❌ Failed to delete record', 'error');
    }
}

// Member Modal
function openMemberModal(id) {
    const modal = document.getElementById('memberModal');
    modal.style.display = 'flex';

    // Fetch single record
    axios.get(`${API_URL}/${id}`)
        .then(response => {
            const record = response.data;
            document.getElementById('memberName').textContent = record.name || 'Unknown';
            document.getElementById('memberPhone').textContent = record.phone || '—';
            document.getElementById('memberGender').textContent = record.gender || '—';
            document.getElementById('memberCategory').textContent = record.category || '—';
            document.getElementById('memberLastCheckin').textContent = record.checkedInTime 
                ? new Date(record.checkedInTime).toLocaleString() 
                : '—';

            // TODO: Fetch full history if you have a separate endpoint
            // For now, fake a simple history
            const historyBody = document.getElementById('historyBody');
            historyBody.innerHTML = '';
            
            // Placeholder – replace with real data later
            const fakeHistory = [
                { date: record.date, service: record.serviceType, status: record.checkedIn ? 'Checked In' : 'Checked Out' }
                // Add more if you store history
            ];

            fakeHistory.forEach(h => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(h.date).toLocaleDateString()}</td>
                    <td>${h.service}</td>
                    <td>${h.status}</td>
                `;
                historyBody.appendChild(tr);
            });

            // Update total visits (placeholder)
            document.getElementById('memberVisitCount').textContent = '1'; // replace with real count
        })
        .catch(error => {
            console.error('Error loading member:', error);
            alert('Failed to load member details');
        });
}

function closeMemberModal() {
    document.getElementById('memberModal').style.display = 'none';
}

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('memberModal');
    if (e.target === modal) {
        closeMemberModal();
    }
});

// Show Notification
function showNotification(message, type = 'info') {
    // Remove existing notification
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 6px;
        color: white;
        font-weight: 600;
        z-index: 1002;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    if (type === 'success') {
        notification.style.background = 'var(--success-color)';
    } else if (type === 'error') {
        notification.style.background = 'var(--accent-color)';
    } else {
        notification.style.background = 'var(--secondary-color)';
    }
    
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add CSS for notification animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);