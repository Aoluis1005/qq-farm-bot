const friendApi = require('./friend-api');
const { getOperationLimits } = require('./friend-operation-limits');
const {
  getFriendsList,
  getFriendLandsDetail,
  getFriendDogInfo,
  batchGetFriendDogInfo,
  fetchFriendsDogInfo,
} = require('./friend-land-analyzer');
const { doFriendOperation } = require('./friend-visit');
const { runGoldenBugPlacement } = require('./golden-bug-service');
const {
  checkFriends,
  startFriendCheckLoop,
  stopFriendCheckLoop,
  refreshFriendCheckLoop,
  runBadOnceOnStartup,
  isHelpExpLimitReached,
  clearFriendsListCache,
  syncFriendsFromGids,
} = require('./friend-orchestrator');

module.exports = {
  checkFriends,
  startFriendCheckLoop,
  stopFriendCheckLoop,
  refreshFriendCheckLoop,
  runBadOnceOnStartup,
  runGoldenBugPlacement,
  isHelpExpLimitReached,
  getOperationLimits,
  getFriendsList,
  getFriendLandsDetail,
  doFriendOperation,
  clearFriendsListCache,
  getFriendDogInfo,
  batchGetFriendDogInfo,
  syncFriendsFromGids,
  fetchFriendsDogInfo,
  delFriend: friendApi.delFriend,
};
