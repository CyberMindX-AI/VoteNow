import React, { useState, useEffect, useCallback } from 'react';

// ─── Data helpers ──────────────────────────────────────────────────────
const normaliseContest = (c) => ({
  ...c,
  votePrice: c.vote_price,
  contestants: (c.contestants || [])
    .sort((a, b) => b.votes - a.votes)
});

const normaliseFeed = (f) => ({
  id:         f.id,
  voter:      f.voter_name,
  contestant: f.contestant_name,
  contest:    f.contest_name,
  ts:         new Date(f.created_at).getTime(),
});

function App() {
  const [contests, setContests]               = useState([]);
  const [feed,     setFeed]                   = useState([]);
  const [loading,  setLoading]                = useState(true);
  const [currentPath, setCurrentPath]         = useState(window.location.pathname);

  // Public modal state
  const [selectedContest,    setSelectedContest]    = useState(null);
  const [selectedContestant, setSelectedContestant] = useState(null);
  const [showShareModal,  setShowShareModal]  = useState(false);
  const [showPayModal,    setShowPayModal]    = useState(false);
  const [voterName,       setVoterName]       = useState('');
  const [voterEmail,      setVoterEmail]      = useState('');
  const [isPaying,        setIsPaying]        = useState(false);
  const [paymentSuccess,  setPaymentSuccess]  = useState(false);
  const [toast,           setToast]           = useState(null);

  // Admin state
  const [adminPassword,   setAdminPassword]   = useState('');
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminError,      setAdminError]      = useState('');
  const [adminTab,        setAdminTab]        = useState('dashboard');

  // Admin form state
  const [newContestName,  setNewContestName]  = useState('');
  const [newContestDesc,  setNewContestDesc]  = useState('');
  const [newContestPrice, setNewContestPrice] = useState(100);
  const [newCtName,       setNewCtName]       = useState('');
  const [newCtContestId,  setNewCtContestId]  = useState('');
  const [newCtPhoto,      setNewCtPhoto]      = useState('');
  const [photoUploading,  setPhotoUploading]  = useState(false);

  // ── Load all data from Supabase ──────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const { data: contestData } = await window.supa
        .from('contests')
        .select('*, contestants(*)')
        .order('created_at', { ascending: true });

      if (contestData) setContests(contestData.map(normaliseContest));

      const { data: feedData } = await window.supa
        .from('feed')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (feedData) setFeed(feedData.map(normaliseFeed));
    } catch (err) {
      console.error('Data load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial load + Realtime subscriptions ─────────────────────────────
  useEffect(() => {
    loadData();

    // Subscribe to ALL table changes → triggers full reload
    const channel = window.supa
      .channel('votenow-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contests' },    loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contestants' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed' },        loadData)
      .subscribe();

    return () => window.supa.removeChannel(channel);
  }, [loadData]);

  // ── Handle share link on page load ───────────────────────────────────
  useEffect(() => {
    if (contests.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const cId = params.get('c');
    const vId = params.get('v');
    if (cId && vId) {
      const contest = contests.find(c => c.id === cId);
      if (contest) {
        const ct = contest.contestants.find(p => p.id === vId);
        if (ct) {
          setSelectedContest(contest);
          setSelectedContestant(ct);
          setShowShareModal(true);
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }
  }, [contests]);

  // ── Popstate (back/forward nav) ───────────────────────────────────────
  useEffect(() => {
    const handler = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // ── Toast ─────────────────────────────────────────────────────────────
  const showNotification = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ══════════════════════════════════════════════════════════════════════
  //  PUBLIC VOTING ACTIONS
  // ══════════════════════════════════════════════════════════════════════

  const handleVoteClick = (contest, contestant) => {
    setSelectedContest(contest);
    setSelectedContestant(contestant);
    setShowShareModal(true);
  };

  const handleProceedToPayment = () => {
    setShowShareModal(false);
    setShowPayModal(true);
  };

  const handleConfirmPayment = () => {
    if (!voterEmail.trim() || !voterEmail.includes('@')) {
      showNotification('Please enter a valid email address', 'error');
      return;
    }
    if (isPaying) return;
    setIsPaying(true);

    const amountKobo = parseInt(selectedContest.votePrice) * 100;

    const handler = window.PaystackPop.setup({
      key: window.ENV_PAYSTACK_PUBLIC_KEY,
      email: voterEmail.trim(),
      amount: amountKobo,
      currency: 'NGN',
      callback: async (response) => {
        // Send reference to backend for verification
        try {
          const res = await fetch('/api/vote/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contestId:    selectedContest.id,
              contestantId: selectedContestant.id,
              voterName:    voterName.trim(),
              reference:    response.reference
            }),
          });
          const data = await res.json();
          if (data.success) {
            setPaymentSuccess(true);
            showNotification(`Vote cast for ${selectedContestant.name}!`);
            setTimeout(loadData, 500);
          } else {
            showNotification(data.error || 'Payment verification failed', 'error');
            setIsPaying(false);
          }
        } catch {
          showNotification('Network error during verification.', 'error');
          setIsPaying(false);
        }
      },
      onClose: () => {
        setIsPaying(false);
      }
    });
    handler.openIframe();
  };

  const closePayModal = () => {
    setShowPayModal(false);
    setPaymentSuccess(false);
    setVoterName('');
    setVoterEmail('');
    setSelectedContest(null);
    setSelectedContestant(null);
  };

  // ══════════════════════════════════════════════════════════════════════
  //  ADMIN ACTIONS
  // ══════════════════════════════════════════════════════════════════════

  const adminFetch = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const data = await adminFetch('/api/admin/login', { password: adminPassword });
      if (data.success) { setIsAdminLoggedIn(true); setAdminError(''); }
      else setAdminError(data.error || 'Invalid credentials');
    } catch { setAdminError('Network error'); }
  };

  const handleCreateContest = async (e) => {
    e.preventDefault();
    const data = await adminFetch('/api/admin/contest/create', {
      name: newContestName, description: newContestDesc, votePrice: newContestPrice
    });
    if (data.success) {
      setNewContestName(''); setNewContestDesc(''); setNewContestPrice(100);
      showNotification('Contest created!');
      // Realtime will update
    } else {
      showNotification(data.error || 'Error creating contest', 'error');
    }
  };

  const handleToggleContest = async (contestId, current) => {
    const data = await adminFetch('/api/admin/contest/toggle', { contestId, active: !current });
    if (data.success) showNotification(`Contest ${!current ? 'activated' : 'paused'}`);
    else showNotification(data.error || 'Error', 'error');
  };

  const handleDeleteContest = async (contestId, name) => {
    if (!window.confirm(`Delete "${name}" and all its contestants?`)) return;
    const data = await adminFetch('/api/admin/contest/delete', { contestId });
    if (data.success) showNotification('Contest deleted');
    else showNotification(data.error || 'Error', 'error');
  };

  const handleAddContestant = async (e) => {
    e.preventDefault();
    if (!newCtContestId) { showNotification('Select a contest', 'error'); return; }
    const data = await adminFetch('/api/admin/contestant/add', {
      contestId: newCtContestId, name: newCtName, photo: newCtPhoto
    });
    if (data.success) {
      setNewCtName(''); setNewCtPhoto(''); setNewCtContestId('');
      showNotification('Contestant added!');
    } else showNotification(data.error || 'Error', 'error');
  };

  const handleDeleteContestant = async (contestantId, name) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    const data = await adminFetch('/api/admin/contestant/delete', { contestantId });
    if (data.success) showNotification('Contestant removed');
    else showNotification(data.error || 'Error', 'error');
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showNotification('Image must be under 10 MB', 'error'); return; }

    setPhotoUploading(true);
    setNewCtPhoto('');
    try {
      // Upload to Supabase Storage bucket 'contestant-photos'
      const ext      = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await window.supa.storage
        .from('contestant-photos')
        .upload(fileName, file, { contentType: file.type, upsert: false });

      if (uploadError) throw uploadError;

      // Get the permanent public URL
      const { data: urlData } = window.supa.storage
        .from('contestant-photos')
        .getPublicUrl(fileName);

      setNewCtPhoto(urlData.publicUrl);
      showNotification('Photo uploaded ✓');
    } catch (err) {
      console.error(err);
      showNotification('Upload failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setPhotoUploading(false);
    }
  };

  // ── Stats for admin dashboard ─────────────────────────────────────────
  const totalContests    = contests.length;
  const activeContests   = contests.filter(c => c.active).length;
  const totalContestants = contests.reduce((s, c) => s + c.contestants.length, 0);
  const totalVotes       = contests.reduce((s, c) => s + c.contestants.reduce((ss, p) => ss + p.votes, 0), 0);
  const totalRevenue     = contests.reduce((s, c) => s + c.contestants.reduce((ss, p) => ss + p.votes * c.votePrice, 0), 0);

  // ──────────────────────────────────────────────────────────────────────
  //  ADMIN VIEW
  // ──────────────────────────────────────────────────────────────────────
  if (currentPath === '/admin') {

    // Login screen
    if (!isAdminLoggedIn) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-white text-black px-4">
          <div className="w-full max-w-md border border-neutral-200 rounded-2xl p-10 bg-white shadow-xl">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-9 h-9 bg-black rounded-lg flex items-center justify-center text-white">
                <i className="fa-solid fa-check text-sm"></i>
              </div>
              <span className="font-extrabold text-xl tracking-tight">VoteNow Admin</span>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight mb-2">Sign In</h2>
            <p className="text-neutral-500 text-sm mb-8">Manage contests, contestants and view live results.</p>
            {adminError && (
              <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg p-3 mb-5 text-sm font-semibold">{adminError}</div>
            )}
            <form onSubmit={handleAdminLogin}>
              <label className="block text-xs font-bold text-neutral-600 uppercase tracking-wider mb-2">Password</label>
              <input
                type="password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:border-black mb-4"
                placeholder="••••••••"
                required
              />
              <button type="submit" className="w-full py-3 bg-black text-white font-extrabold rounded-lg hover:bg-neutral-800 transition">
                Enter Dashboard →
              </button>
            </form>
            <div className="mt-6 text-center">
              <button onClick={() => navigateTo('/')} className="text-neutral-400 hover:text-black font-semibold text-sm transition">
                <i className="fa-solid fa-arrow-left mr-2"></i>Back to Voting Feed
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Admin dashboard
    return (
      <div className="min-h-screen bg-neutral-50 text-black flex flex-col md:flex-row">

        {/* Sidebar / Top Nav on Mobile */}
        <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-neutral-200 p-4 md:p-6 flex flex-col justify-between md:fixed inset-y-0 left-0 z-20">
          <div>
            <div className="flex items-center justify-between md:mb-10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-black rounded flex items-center justify-center text-white">
                  <i className="fa-solid fa-check text-sm"></i>
                </div>
                <span className="font-bold text-lg tracking-tight">VoteNow Admin</span>
              </div>
              
              <div className="md:hidden flex gap-3">
                <button onClick={() => navigateTo('/')} className="text-neutral-500 hover:text-black">
                  <i className="fa-solid fa-eye"></i>
                </button>
                <button onClick={() => setIsAdminLoggedIn(false)} className="text-red-500 hover:text-red-700">
                  <i className="fa-solid fa-sign-out-alt"></i>
                </button>
              </div>
            </div>

            <div className="hidden md:block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3 px-3">Overview</div>
            <nav className="flex flex-row md:flex-col gap-2 overflow-x-auto mt-4 md:mt-0 pb-2 md:pb-0 scrollbar-hide">
              {[
                { key: 'dashboard',   icon: 'fa-chart-line',    label: 'Dashboard' },
                { key: 'contests',    icon: 'fa-award',          label: 'Contests' },
                { key: 'contestants', icon: 'fa-user-group',     label: 'Contestants' },
                { key: 'results',     icon: 'fa-ranking-star',   label: 'Results' },
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => setAdminTab(item.key)}
                  className={`flex-shrink-0 flex items-center gap-2 md:gap-3 px-3 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold transition ${
                    adminTab === item.key
                      ? 'bg-black text-white'
                      : 'text-neutral-500 hover:bg-neutral-100 hover:text-black'
                  }`}
                >
                  <i className={`fa-solid ${item.icon} w-3 md:w-4`}></i>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="hidden md:block border-t border-neutral-100 pt-4 space-y-1">
            <button onClick={() => navigateTo('/')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-neutral-500 hover:bg-neutral-100 hover:text-black transition">
              <i className="fa-solid fa-eye w-4"></i> View Live Site
            </button>
            <button onClick={() => setIsAdminLoggedIn(false)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-50 transition">
              <i className="fa-solid fa-sign-out-alt w-4"></i> Logout
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="md:ml-64 flex-1 p-4 md:p-10 min-h-screen">

          {/* ── Dashboard ── */}
          {adminTab === 'dashboard' && (
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-1">Dashboard</h1>
              <p className="text-neutral-400 text-sm mb-8">Live overview of all voting activity.</p>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-8">
                {[
                  { label: 'Total Contests',    value: totalContests },
                  { label: 'Active',            value: activeContests },
                  { label: 'Contestants',       value: totalContestants },
                  { label: 'Total Votes',       value: totalVotes.toLocaleString() },
                  { label: 'Est. Revenue',      value: `₦${totalRevenue.toLocaleString()}` },
                ].map((s, i) => (
                  <div key={i} className="bg-white border border-neutral-200 rounded-xl p-4 md:p-5 shadow-sm">
                    <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1 md:mb-2">{s.label}</div>
                    <div className="text-2xl md:text-3xl font-extrabold tracking-tight">{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-100 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  <h3 className="font-bold text-sm">Live Activity Feed</h3>
                </div>
                <div className="divide-y divide-neutral-50">
                  {feed.slice(0, 15).map(f => (
                    <div key={f.id} className="px-6 py-3 flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-bold">{f.voter}</span>
                        <span className="text-neutral-400"> voted for </span>
                        <span className="font-bold">{f.contestant}</span>
                        <span className="text-neutral-400"> in </span>
                        <span className="text-neutral-500">{f.contest}</span>
                      </div>
                      <span className="text-xs text-neutral-300 font-semibold whitespace-nowrap ml-4">
                        {new Date(f.ts).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                  {feed.length === 0 && (
                    <p className="text-center py-10 text-neutral-300 text-sm">No votes yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Contests ── */}
          {adminTab === 'contests' && (
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-1">Contests</h1>
              <p className="text-neutral-400 text-sm mb-8">Create and manage voting contests.</p>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Create form */}
                <div className="bg-white border border-neutral-200 rounded-xl p-6 shadow-sm h-fit">
                  <h3 className="font-bold text-base mb-5">Create New Contest</h3>
                  <form onSubmit={handleCreateContest} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Contest Name *</label>
                      <input value={newContestName} onChange={e => setNewContestName(e.target.value)} type="text" className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:border-black text-sm" placeholder="e.g. Miss Nigeria 2025" required />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Description</label>
                      <textarea value={newContestDesc} onChange={e => setNewContestDesc(e.target.value)} className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:border-black text-sm resize-none" rows="2" placeholder="Brief description..."></textarea>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Vote Price (₦) *</label>
                      <input value={newContestPrice} onChange={e => setNewContestPrice(e.target.value)} type="number" min="1" className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:border-black text-sm" required />
                    </div>
                    <button type="submit" className="w-full py-2.5 bg-black text-white font-bold rounded-lg hover:bg-neutral-800 transition text-sm">
                      Create Contest
                    </button>
                  </form>
                </div>

                {/* Contests table */}
                <div className="lg:col-span-2 bg-white border border-neutral-200 rounded-xl shadow-sm overflow-x-auto">
                  <table className="w-full text-left min-w-[600px]">
                    <thead className="bg-neutral-50 border-b border-neutral-200">
                      <tr>
                        {['Contest', 'Price / Vote', 'Contestants', 'Total Votes', 'Status', 'Actions'].map(h => (
                          <th key={h} className="px-5 py-3.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {contests.map(c => {
                        const tv = c.contestants.reduce((s, p) => s + p.votes, 0);
                        return (
                          <tr key={c.id} className="hover:bg-neutral-50">
                            <td className="px-5 py-4">
                              <div className="font-bold text-sm">{c.name}</div>
                              {c.description && <div className="text-xs text-neutral-400 mt-0.5 truncate max-w-[160px]">{c.description}</div>}
                            </td>
                            <td className="px-5 py-4 font-bold text-sm">₦{Number(c.votePrice).toLocaleString()}</td>
                            <td className="px-5 py-4 text-sm font-semibold">{c.contestants.length}</td>
                            <td className="px-5 py-4 text-sm font-bold">{tv.toLocaleString()}</td>
                            <td className="px-5 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${c.active ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
                                {c.active ? '● Active' : '○ Paused'}
                              </span>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <button onClick={() => handleToggleContest(c.id, c.active)} className="text-xs font-bold text-neutral-500 hover:text-black transition">
                                  {c.active ? 'Pause' : 'Activate'}
                                </button>
                                <button onClick={() => handleDeleteContest(c.id, c.name)} className="text-xs font-bold text-red-400 hover:text-red-600 transition">
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {contests.length === 0 && (
                        <tr><td colSpan="6" className="text-center py-12 text-neutral-300 text-sm">No contests yet. Create one above.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Contestants ── */}
          {adminTab === 'contestants' && (
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-1">Contestants</h1>
              <p className="text-neutral-400 text-sm mb-8">Upload photos and add contestants to contests.</p>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Add form */}
                <div className="bg-white border border-neutral-200 rounded-xl p-6 shadow-sm h-fit">
                  <h3 className="font-bold text-base mb-5">Add Contestant</h3>
                  <form onSubmit={handleAddContestant} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Contest *</label>
                      <select value={newCtContestId} onChange={e => setNewCtContestId(e.target.value)} className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:border-black text-sm" required>
                        <option value="">Select contest…</option>
                        {contests.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Full Name *</label>
                      <input value={newCtName} onChange={e => setNewCtName(e.target.value)} type="text" className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:border-black text-sm" placeholder="Contestant's full name" required />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Photo</label>
                      <input type="file" accept="image/*" onChange={handlePhotoUpload} className="w-full text-sm px-3 py-2 border border-neutral-200 rounded-lg" />
                      {newCtPhoto && (
                        <img src={newCtPhoto} className="w-20 h-20 object-cover rounded-full mt-3 border-2 border-neutral-200" />
                      )}
                    </div>
                    <button type="submit" className="w-full py-2.5 bg-black text-white font-bold rounded-lg hover:bg-neutral-800 transition text-sm">
                      Add Contestant
                    </button>
                  </form>
                </div>

                {/* Contestants table */}
                <div className="lg:col-span-2 bg-white border border-neutral-200 rounded-xl shadow-sm overflow-x-auto">
                  <table className="w-full text-left min-w-[500px]">
                    <thead className="bg-neutral-50 border-b border-neutral-200">
                      <tr>
                        {['Contestant', 'Contest', 'Votes', ''].map((h, i) => (
                          <th key={i} className="px-5 py-3.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {contests.flatMap(c =>
                        c.contestants.map(p => ({ ...p, contestName: c.name }))
                      ).map(p => (
                        <tr key={p.id} className="hover:bg-neutral-50">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              {p.photo
                                ? <img src={p.photo} className="w-9 h-9 rounded-full object-cover border border-neutral-200" />
                                : <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-sm">👤</div>
                              }
                              <span className="font-bold text-sm">{p.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm text-neutral-500">{p.contestName}</td>
                          <td className="px-5 py-4 font-extrabold text-sm">{p.votes}</td>
                          <td className="px-5 py-4">
                            <button onClick={() => handleDeleteContestant(p.id, p.name)} className="text-xs font-bold text-red-400 hover:text-red-600 transition">Remove</button>
                          </td>
                        </tr>
                      ))}
                      {totalContestants === 0 && (
                        <tr><td colSpan="4" className="text-center py-12 text-neutral-300 text-sm">No contestants yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {adminTab === 'results' && (
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-1">Live Results</h1>
              <p className="text-neutral-400 text-sm mb-8">Real-time standings — updates automatically via Supabase.</p>
              <div className="space-y-6">
                {contests.map(c => {
                  const tv = c.contestants.reduce((s, p) => s + p.votes, 0);
                  return (
                    <div key={c.id} className="bg-white border border-neutral-200 rounded-xl p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="font-extrabold text-xl">{c.name}</h3>
                          <p className="text-neutral-400 text-xs mt-1">{tv} total votes · ₦{(tv * c.votePrice).toLocaleString()} revenue · ₦{Number(c.votePrice).toLocaleString()} / vote</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${c.active ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
                          {c.active ? '● Live' : '○ Paused'}
                        </span>
                      </div>
                      <div className="space-y-4">
                        {c.contestants.map((p, idx) => {
                          const pct = tv > 0 ? (p.votes / tv) * 100 : 0;
                          const medals = ['🥇','🥈','🥉'];
                          return (
                            <div key={p.id}>
                              <div className="flex justify-between items-center mb-1.5 text-sm">
                                <div className="flex items-center gap-2 font-semibold">
                                  <span>{medals[idx] || `#${idx+1}`}</span>
                                  {p.photo && <img src={p.photo} className="w-6 h-6 rounded-full object-cover" />}
                                  <span>{p.name}</span>
                                </div>
                                <span className="text-neutral-500 text-xs">{p.votes} ({pct.toFixed(1)}%)</span>
                              </div>
                              <div className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden">
                                <div className="bg-black h-full rounded-full transition-all duration-700" style={{ width: `${pct}%` }}></div>
                              </div>
                            </div>
                          );
                        })}
                        {c.contestants.length === 0 && <p className="text-neutral-300 text-sm text-center py-4">No contestants in this contest.</p>}
                      </div>
                    </div>
                  );
                })}
                {contests.length === 0 && <p className="text-neutral-400 text-center py-16">No contests created yet.</p>}
              </div>
            </div>
          )}

        </main>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PUBLIC VOTING VIEW
  // ──────────────────────────────────────────────────────────────────────
  const activeContestsList = contests.filter(c => c.active);
  const shareUrl = (c, p) => `${window.location.origin}/?c=${c.id}&v=${p.id}`;

  return (
    <div className="min-h-screen pb-24">

      {/* ── Live ticker ── */}
      <div className="h-10 bg-white text-black flex items-center justify-between px-6 overflow-hidden fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center gap-2 flex-shrink-0 mr-4">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-ping flex-shrink-0"></span>
          <span className="text-[10px] font-extrabold uppercase tracking-widest">Live</span>
        </div>
        <div className="ticker-wrap flex-1">
          <div className="ticker-content text-[11px] font-bold text-black">
            {[...feed, ...feed].map((f, i) => (
              <span key={`${f.id}-${i}`} className="mx-8">
                🗳️ <strong>{f.voter}</strong> voted for <strong>{f.contestant}</strong> in {f.contest}
              </span>
            ))}
            {feed.length === 0 && <span>Welcome to VoteNow — Live voting is open. Cast your vote now! 🗳️</span>}
          </div>
        </div>
      </div>

      {/* ── Navbar ── */}
      <nav className="h-16 px-6 md:px-12 flex justify-between items-center border-b border-neutral-900 bg-black/80 backdrop-blur-lg fixed top-10 left-0 right-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded flex items-center justify-center text-black font-bold">
            <i className="fa-solid fa-check text-sm"></i>
          </div>
          <span className="font-extrabold text-xl tracking-tight">VoteNow</span>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="pt-36 pb-16 px-6 md:px-12 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-6 bg-neutral-900/60">
          <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
          Secure Web Voting Feed
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-none mb-5">
          Vote for<br />
          <span className="text-neutral-500 font-light italic">your favourite.</span>
        </h1>
        <p className="text-neutral-400 text-base md:text-lg max-w-lg leading-relaxed">
          Choose your contestant, make the vote fee payment, and share to gather more supporters. Standings update in real-time.
        </p>
      </div>

      {/* ── Contest grid ── */}
      <div className="px-6 md:px-12 max-w-7xl mx-auto space-y-16">

        {loading && (
          <div className="text-center py-20 text-neutral-600">
            <i className="fa-solid fa-circle-notch animate-spin text-3xl mb-4"></i>
            <p className="text-sm">Loading contests…</p>
          </div>
        )}

        {!loading && activeContestsList.map(c => {
          const tv = c.contestants.reduce((s, p) => s + p.votes, 0);
          return (
            <div key={c.id} className="border-t border-neutral-900 pt-10">
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{c.name}</h2>
                  {c.description && <p className="text-neutral-500 text-sm mt-1">{c.description}</p>}
                </div>
                <div className="px-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-full text-xs font-bold text-neutral-300 whitespace-nowrap ml-4">
                  ₦{Number(c.votePrice).toLocaleString()} / Vote
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                {c.contestants.map((p, idx) => {
                  const pct = tv > 0 ? (p.votes / tv) * 100 : 0;
                  return (
                    <div key={p.id} className="glass-card rounded-2xl overflow-hidden flex flex-col">
                      <div className="relative aspect-[3/4] bg-neutral-900 flex items-center justify-center">
                        {p.photo
                          ? <img src={p.photo} className="w-full h-full object-cover" />
                          : <div className="text-5xl text-neutral-700">👤</div>
                        }
                        <div className="absolute top-3 left-3 w-7 h-7 rounded-full bg-black/80 border border-neutral-700 flex items-center justify-center font-bold text-[11px]">
                          #{idx+1}
                        </div>
                        <button
                          onClick={() => handleVoteClick(c, p)}
                          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/85 border border-neutral-700 flex items-center justify-center text-[11px] hover:bg-white hover:text-black transition"
                          title="Share"
                        >
                          <i className="fa-solid fa-share-nodes"></i>
                        </button>
                      </div>
                      <div className="p-4 flex flex-col flex-1">
                        <h4 className="font-extrabold text-sm mb-2 truncate">{p.name}</h4>
                        <div className="flex justify-between text-[11px] text-neutral-400 font-semibold mb-1.5">
                          <span>{p.votes.toLocaleString()} votes</span>
                          <span>{pct.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-neutral-800 h-1 rounded-full overflow-hidden mb-4">
                          <div className="bg-white h-full transition-all duration-700" style={{ width: `${pct}%` }}></div>
                        </div>
                        <button
                          onClick={() => handleVoteClick(c, p)}
                          className="mt-auto w-full py-2 bg-white text-black font-extrabold text-[11px] uppercase tracking-wider rounded-lg hover:bg-neutral-200 transition"
                        >
                          Cast Vote
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!loading && activeContestsList.length === 0 && (
          <div className="text-center py-24 border-t border-neutral-900">
            <i className="fa-solid fa-box-open text-neutral-800 text-5xl mb-4"></i>
            <h3 className="text-xl font-bold mb-2">No Active Contests</h3>
            <p className="text-neutral-500 text-sm">Come back later</p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════
          SHARE MODAL
      ═══════════════════════════════════════════════ */}
      {showShareModal && selectedContestant && selectedContest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-neutral-950 border border-neutral-800 rounded-2xl p-7 relative fade-in">
            <button onClick={() => setShowShareModal(false)} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white transition text-lg font-bold">×</button>

            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-xl mb-3">📤</div>
              <h3 className="text-xl font-extrabold mb-1">Rally Support</h3>
              <p className="text-neutral-500 text-xs leading-relaxed">Share this link — anyone who clicks it lands directly on this contestant's vote page.</p>
            </div>

            {/* Contestant preview */}
            <div className="flex items-center gap-3 bg-neutral-900/60 border border-neutral-800 p-3.5 rounded-xl mb-6">
              {selectedContestant.photo
                ? <img src={selectedContestant.photo} className="w-12 h-12 object-cover rounded-full flex-shrink-0" />
                : <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-lg flex-shrink-0">👤</div>
              }
              <div>
                <div className="font-bold text-sm">{selectedContestant.name}</div>
                <div className="text-neutral-500 text-xs">{selectedContest.name} · ₦{Number(selectedContest.votePrice).toLocaleString()} / vote</div>
              </div>
            </div>

            {/* Share buttons */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`🗳️ Vote for ${selectedContestant.name} on VoteNow!\n${shareUrl(selectedContest, selectedContestant)}`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-bold hover:border-white transition"
              >
                <i className="fa-brands fa-whatsapp text-green-500"></i> WhatsApp
              </a>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🗳️ Vote for ${selectedContestant.name} on VoteNow!`)}&url=${encodeURIComponent(shareUrl(selectedContest, selectedContestant))}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-bold hover:border-white transition"
              >
                <i className="fa-brands fa-x-twitter"></i> Twitter / X
              </a>
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl(selectedContest, selectedContestant))}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-bold hover:border-white transition"
              >
                <i className="fa-brands fa-facebook text-blue-500"></i> Facebook
              </a>
              <a
                href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl(selectedContest, selectedContestant))}&text=${encodeURIComponent(`🗳️ Vote for ${selectedContestant.name}!`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-bold hover:border-white transition"
              >
                <i className="fa-brands fa-telegram text-blue-400"></i> Telegram
              </a>
            </div>

            {/* Copy link */}
            <div className="flex gap-2 mb-5">
              <input
                readOnly
                value={shareUrl(selectedContest, selectedContestant)}
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-400 focus:outline-none focus:border-white"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl(selectedContest, selectedContestant));
                  showNotification('Link copied!');
                }}
                className="px-4 bg-white text-black font-extrabold text-xs rounded-xl hover:bg-neutral-200 transition"
              >
                Copy
              </button>
            </div>

            <hr className="border-neutral-800 mb-5" />
            <button onClick={handleProceedToPayment} className="w-full py-3 bg-white text-black font-extrabold text-xs uppercase tracking-wider rounded-xl hover:bg-neutral-200 transition">
              Continue to Vote →
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          PAYMENT MODAL
      ═══════════════════════════════════════════════ */}
      {showPayModal && selectedContestant && selectedContest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-neutral-950 border border-neutral-800 rounded-2xl p-7 relative fade-in">
            <button onClick={closePayModal} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white transition text-lg font-bold">×</button>

            {!paymentSuccess ? (
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-xl mb-3">💳</div>
                  <h3 className="text-xl font-extrabold mb-1">Complete Payment</h3>
                  <p className="text-neutral-500 text-xs">Your vote is permanent and counted instantly on payment.</p>
                </div>

                <div className="flex justify-between items-baseline mb-6 pb-5 border-b border-neutral-800">
                  <span className="text-neutral-400 text-sm">Amount Due</span>
                  <span className="text-4xl font-extrabold tracking-tight">₦{Number(selectedContest.votePrice).toLocaleString()}</span>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 space-y-2 text-xs mb-5">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Voting for</span>
                    <span className="font-bold text-neutral-200">{selectedContestant.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Contest</span>
                    <span className="font-bold text-neutral-200">{selectedContest.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Vote fee</span>
                    <span className="font-bold text-neutral-200">₦{Number(selectedContest.votePrice).toLocaleString()}</span>
                  </div>
                </div>

                <input
                  type="email"
                  value={voterEmail}
                  onChange={e => setVoterEmail(e.target.value)}
                  placeholder="Your email address (Required for receipt)"
                  required
                  className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-white mb-3 placeholder-neutral-600"
                />
                <input
                  type="text"
                  value={voterName}
                  onChange={e => setVoterName(e.target.value)}
                  placeholder="Your name (optional — shown in live feed)"
                  className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-white mb-4 placeholder-neutral-600"
                />

                <button
                  onClick={handleConfirmPayment}
                  disabled={isPaying}
                  className="w-full py-3.5 bg-white text-black font-extrabold text-sm uppercase tracking-wider rounded-xl hover:bg-neutral-200 transition flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isPaying ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-lock text-xs"></i>}
                  {isPaying ? 'Processing…' : `Pay ₦${Number(selectedContest.votePrice).toLocaleString()} & Vote`}
                </button>
                <p className="text-center text-neutral-600 text-[10px] mt-3">Secure payment · Vote is credited instantly to Supabase</p>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto text-3xl text-green-400 mb-5 vote-success">
                  <i className="fa-solid fa-check"></i>
                </div>
                <h3 className="text-2xl font-extrabold mb-2">Vote Cast! 🎉</h3>
                <p className="text-neutral-400 text-sm mb-8">Your vote for <strong className="text-white">{selectedContestant.name}</strong> has been registered and the standings have been updated.</p>
                <button onClick={closePayModal} className="px-8 py-2.5 bg-neutral-900 border border-neutral-800 hover:border-white text-white font-bold text-xs uppercase tracking-wider rounded-xl transition">
                  Back to Feed
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl text-xs font-semibold fade-in max-w-xs">
          <span className={toast.type === 'success' ? 'text-green-400' : 'text-red-400'}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
          </span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
