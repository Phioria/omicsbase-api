const Users = require('../models').user;
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const handleRefreshToken = async (req, res) => {
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.sendStatus(401);

    const refreshToken = cookies.jwt;

    const foundUser = await Users.findOne({
        where: { refresh_token: refreshToken },
    });
    if (!foundUser) return res.sendStatus(403); // Forbidden

    // Evaluate jwt
    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, decoded) => {
        if (err || foundUser.username !== decoded.username) {
            logger.log('info', `[handleRefreshToken] - Usernames did not match - DB: [${foundUser.username}] - TOKEN: [${decoded.username}]`);
            return res.sendStatus(403);
        }
        const username = foundUser.username;
        const roles = Object.values(foundUser.roles);
        const accessToken = jwt.sign(
            {
                UserInfo: {
                    username: decoded.username,
                    roles: roles,
                },
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '30m' }
        );
        res.json({ username, roles, accessToken });
    });
};

module.exports = { handleRefreshToken };
