const db = require("../models");
const User = db.user;
const Session = db.session;
const { encrypt } = require("../authentication/crypto");

exports.githubLogin = async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).send({ message: "Missing GitHub code." });
  }

  try {
   
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.status(401).send({ message: "GitHub authorization failed." });
    }

    const profileRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${tokenData.access_token}` },
    });
    const githubUser = await profileRes.json();

    if (!githubUser || !githubUser.id) {
      return res.status(403).send({ message: "Unable to verify GitHub account." });
    }
    const [firstName, ...rest] = (githubUser.name || githubUser.login).split(" ");
    const lastName = rest.join(" ") || "-";

    const [user] = await User.findOrCreate({
      where: { githubId: String(githubUser.id) },
      defaults: {
        githubId: String(githubUser.id),
        firstName,
        lastName,
        email: githubUser.email,
        avatarUrl: githubUser.avatar_url,
      },
    });

    
    let expireTime = new Date();
    expireTime.setDate(expireTime.getDate() + 1);

    const session = {
      email: user.email,
      userId: user.id,
      expirationDate: expireTime,
    };
    const data = await Session.create(session);
    let sessionId = data.id;
    let token = await encrypt(sessionId);

    let userInfo = {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isAdmin: user.isAdmin,
      id: user.id,
      token: token,
    };
    res.send(userInfo);
  } catch (err) {
    console.error(err);
    res.status(500).send({
      message: err.message || "Some error occurred during GitHub authentication.",
    });
  }
};