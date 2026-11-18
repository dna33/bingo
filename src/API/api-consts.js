import { publicNetwork } from '../../config/public-network';

const { consoleUrl, apiBaseUrl } = publicNetwork(window.BINGO_CONFIG);
const ApiConsts = {
  PILOT: `${apiBaseUrl}/pilot`,
  CONF: `${consoleUrl}/config.json`,
  REGISTER: `${apiBaseUrl}/register`,
  LOGIN: `${apiBaseUrl}/login`,
  PROFILE: `${apiBaseUrl}/profile`,
  SET_BALANCE: `${apiBaseUrl}/setNewBalance`,
  GET_PLAYERS_DATA: `${apiBaseUrl}/getPlayersData`,
  CREATE_PLAYER: `${apiBaseUrl}/createPlayer`,
  UPDATE_PLAYER_DATA: `${apiBaseUrl}/updatePlayerData`,
  DELETE_PLAYER: `${apiBaseUrl}/deletePlayer`,
  LOGIN_ADMIN: `${apiBaseUrl}/loginAdmin`,
  SET_WINS: `${apiBaseUrl}/setWins`
};

export default ApiConsts;
