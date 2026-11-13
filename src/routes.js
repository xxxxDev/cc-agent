import ChatListPage from './agent-pages/ChatListPage.vue';
import ConversationPage from './agent-pages/ConversationPage.vue';
import StartPage from './agent-pages/StartPage.vue';
import SchedulesPage from './pages/SchedulesPage.vue';
import GroupsPage from './pages/GroupsPage.vue';
import GroupRoomPage from './pages/GroupRoomPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import AdminPage from './pages/AdminPage.vue';
import ChangePasswordPage from './pages/ChangePasswordPage.vue';
import ScanLoginPage from './pages/ScanLoginPage.vue';
import DevicesPage from './pages/DevicesPage.vue';
import TwoStepPage from './pages/TwoStepPage.vue';
import PasskeysPage from './pages/PasskeysPage.vue';
import UsersPage from './pages/UsersPage.vue';
import UserEditPage from './pages/UserEditPage.vue';
import AccessReportsPage from './pages/AccessReportsPage.vue';
import AccessReportDetailPage from './pages/AccessReportDetailPage.vue';
import DiagnosticReportsPage from './pages/DiagnosticReportsPage.vue';
import NavButtonsPage from './pages/NavButtonsPage.vue';
import DiagnosticReportDetailPage from './pages/DiagnosticReportDetailPage.vue';
import SecurityPage from './pages/SecurityPage.vue';
import PeerLinkPage from './pages/PeerLinkPage.vue';
import DeletedAgentsPage from './agent-pages/DeletedAgentsPage.vue';

// Tab-view roots. Each F7 view owns its own router stack and resolves its url here.
export default [
  // Where the Agents tab opens, until it knows whether a notification asked for one.
  { path: '/start/', component: StartPage },
  { path: '/', component: ChatListPage },
  { path: '/conversation/', component: ConversationPage },
  // Deleted agents, restored or kept from here (pushed within the #view-chat stack).
  { path: '/deleted-agents/', component: DeletedAgentsPage },
  // Group chats: the list, and one group pushed within the #view-groups stack.
  { path: '/groups/', component: GroupsPage },
  { path: '/group/', component: GroupRoomPage },
  { path: '/schedules/', component: SchedulesPage },


  { path: '/settings/', component: SettingsPage },
  // Settings detail push (within the #view-settings router stack).
  { path: '/change-password/', component: ChangePasswordPage },
  // QR sign-in: this phone as a login key, and the account's devices.
  { path: '/scan-login/', component: ScanLoginPage },
  { path: '/devices/', component: DevicesPage },
  // Two-step sign-in for this account.
  { path: '/two-step/', component: TwoStepPage },
  { path: '/passkeys/', component: PasskeysPage },

  // The admin's tab; everything below is pushed within the #view-admin stack.
  { path: '/admin/', component: AdminPage },
  { path: '/users/', component: UsersPage },

  // User edit, opened from Manage Users rows.
  { path: '/user/', component: UserEditPage },

  // Scope reports, an admin's review queue (SECURITY.md).
  { path: '/access-reports/', component: AccessReportsPage },
  { path: '/access-report/', component: AccessReportDetailPage },
  // Diagnostics people sent from Agent Profile.
  { path: '/diagnostic-reports/', component: DiagnosticReportsPage },
  { path: '/nav-buttons/', component: NavButtonsPage },
  { path: '/diagnostic-report/', component: DiagnosticReportDetailPage },
  // Sign-in defence: what was tried and which addresses are blocked.
  { path: '/security/', component: SecurityPage },
  // The peer link: this machine paired with another CC Agent.
  { path: '/peer-link/', component: PeerLinkPage },

];
