var Spotify = require('spotify-web');
var fs = require('fs');
var nodefs = require('node-fs');
var path = require('path');
var request = require('request');
var colorize = require('colorize');
var cconsole = colorize.console;
var StringDecoder = require('string_decoder').StringDecoder;
var asyncblock = require('asyncblock');
var exec = require('child_process').exec;

var spotutil = require('spotify-web/lib/util');

console.log("Spotify Downloader");

// determine the URI to play, ensure it's a "track" URI
var spotifyuri = new Array();
var downloadplaylists = Array();
var downloadtracks = Array();
var downloadalbums = Array();
var downloadartists = Array();

var settings = Object();
settings.cache = true;

if (!fs.existsSync(__dirname + "/songs/"))
{
  cconsole.log("#red[ERROR! Mount CRYPT disk and retry!]");
  return;
}


for (i in process.argv)
{
  if (i == 0 || i == 1)
  {
    continue;
  }
  var s_uri = process.argv[i].match(/https:\/\/play\.spotify\.com\/(.*?)\/(.*?)(\/|)$/i);
  // https://play.spotify.com/user/1172546215/playlist/488IX9RsdSFTaZuItjYGY7
  var p_uri = process.argv[i].match(/https:\/\/play\.spotify\.com\/user\/(.*?)\/playlist\/(.*?)$/i);
  var is_arg = process.argv[i].match(/^\-([A-Za-z0-9]{1})$|^\-\-([A-Za-z0-9]{1,8})$/);

  if (p_uri)
  {
    p_uri = "spotify:user:" + p_uri[1] + ":playlist:" + p_uri[2];
    console.log(p_uri);
    if (Spotify.uriType(p_uri) == "playlist")
    {
      downloadplaylists.push(p_uri);
      spotifyuri.push(p_uri);
    }
  }
  else if (s_uri)
  {
    s_uri = "spotify:" + s_uri[1] + ":" + s_uri[2];
    console.log(s_uri);
    if (Spotify.uriType(s_uri) == "track")
    {
      downloadtracks.push(s_uri);
      spotifyuri.push(s_uri);
    }
    if (Spotify.uriType(s_uri) == "album")
    {
      downloadalbums.push(s_uri);
      spotifyuri.push(s_uri);
    }
    if (Spotify.uriType(s_uri) == "artist")
    {
      console.log("We got an artist");
      downloadartists.push(s_uri);
      spotifyuri.push(s_uri);
    }
  }
  else if (is_arg)
  {
    var argument = process.argv[i];

    if (argument == "-c" || argument == "--nocache")
    {
      console.log("No cache!");
      settings.cache = false;
    }
  }
  else
  {
    console.log(process.argv[i] + " <=== NOT RECOGNIZED");
  }
}

if (spotifyuri.length == 0)
{
  console.log("No spotify url passed!");
  process.exit(code = 0);
}

//READY TO DOWNLOAD
cconsole.log("#blue[Ready to download " + downloadalbums.length + " albums, " + downloadtracks.length + " songs and " + downloadplaylists.length + " playlists...");

// initiate the Spotify session

function escapefilename(name)
{
  //name = name.replace("/","_");
  name = name.replace(/[^A-Za-z0-9_\-\.\(\)]/g, "_");
  return name;
}

function getsongbyuri(err, spotify, uri, savepath, count, cb)
{
  if (typeof(cb) != "function")
  {
    cb = function() {};
  }
  var sp = spotify;
  console.log(uri);
  try
  {
    var uritype = Spotify.uriType(uri);
    cconsole.log("#green[Got uri type! " + uritype + "]");
  }
  catch (err)
  {
    cconsole.log("#red[ERROR WHILE TRYING TO GET TYPE OF " + uri + "!!]");
    getsongbyuri(err, spotify, uri, savepath, count, cb);
    return;
  }
  try
  {
    console.log("OKK");
    spotify.get(uri, function(err, track)
    {
      if (err)
      {
        if (uri.match(/^spotify:local:.*?$/i))
        {
          cconsole.log("#red[spotify:local?]")
          count++;
          cb(savepath + "aa", track, spotify, false, "cached");
          return;
        }
        else
        {
          cconsole.log("#red[ERROR!]");
          console.log(err);
          setTimeout(function()
          {
            getsongbyuri(null, spotify, uri, savepath, count, cb);
          }, 2000);
          return;
        }
      }

      if (count == 0)
      {
        tracknum = "";
      }
      else
      {
        tracknum = count + ". ";
      }

      if (fs.existsSync(savepath + escapefilename(tracknum + track.artist[0].name + " - " + track.name) + ".mp3") && settings.cache)
      {
        var stats = fs.statSync(savepath + escapefilename(tracknum + track.artist[0].name + " - " + track.name) + ".mp3");
        if (stats['size'] > 100)
        {
          cconsole.log("#yellow[Not downloaded \"" + track.artist[0].name + " - " + track.name + "\" because is already downloaded]");
          count++;
          cb(savepath + track.artist[0].name + " - " + track.name + ".mp3", track, spotify, false, "cached");
          return;
        }
      }

      console.log('Trying to download %s - %s ...', track.artist[0].name, track.name);

      try
      {
        var play = track.play();
      }
      catch (error)
      {
        cconsole.log("#red[Error while downloading track, skipping to next]");
        cb(savepath + track.artist[0].name + " - " + track.name + ".mp3", track, spotify, false);
        //getsongbyuri(null,spotify,uri,savepath,count*1+1,cb);
        return;
      }

      play.on("error", function(err)
      {
        if (err.code == 8)
        {
          //Rate limit exceded!
          console.log("Retrying to download...");
          dospotifylogin(spotify, function(err, spot)
          {
            if (err) throw err;
            sp = spotify;
            getsongbyuri(null, spot, uri, savepath, count, cb);
          });
          return;
        }
        if (typeof(err.message) != "undefined")
        {
          console.log(err.message);
          if (err.message.toString().indexOf("not playable in country") != -1)
          {
            cconsole.log("#red[Track not playable in your country!]");
            cb(savepath + track.artist[0].name + " - " + track.name + ".mp3", track, spotify, false);
          }
          else
          {
            cconsole.log("#red[ERROR:" + err.message + "]");
            cconsole.log("#yellow[Retrying to download...]");
            setTimeout(function()
            {
              dospotifylogin(spotify, function(err, spotify)
              {
                if (err) throw err;
                sp = spotify;
                getsongbyuri(null, spotify, uri, savepath, count, cb);
              });
            }, 2500);
            return 0;
          }
        }
        else
        {
          cconsole.log("#red[ERROR!!!]");
          console.log(err);
        }

        return;
      });

      var date = new Date();
      var output = fs.createWriteStream(savepath + escapefilename(tracknum + track.artist[0].name + " - " + track.name) + ".mp3");
      play.pipe(output);

      play.on("data", function(data) {

      }).on("end", function()
      {
        //fs.writeFileSync("/var/node/spotify/1.mp3",buffer);
        //spotify.disconnect();
        cb(savepath + escapefilename(tracknum + track.artist[0].name + " - " + track.name) + ".mp3", track, spotify);
      });

    });
  }
  catch (error)
  {
    cconsole.log("#red[Got an error, retrying...]");
    cb(savepath + track.artist[0].name + " - " + track.name + ".mp3", track, spotify, false);
  }
}

function getsongsbyalbum(spotify, uri, cb)
{
  if (typeof(cb) != "function")
  {
    cb = function() {};
  }
  try
  {
    spotify.on("error", function(a)
    {
      console.log("ERRORE!", a);
    });
    spotify.get(uri, function(err, album)
    {
      if (err)
      {
        cconsole.log("#red[ERROR!]");
        console.log(err);
      }
      var tracks = [];
      album.disc.forEach(function(disc)
      {
        if (!Array.isArray(disc.track)) return;
        tracks.push.apply(tracks, disc.track);
      });

      var tracks = tracks.map(function(t)
      {
        return t.uri;
      });
      cb(tracks, album);
    });
  }
  catch (error)
  {
    console.log("ERRORE!", error);
  }
}

function gettopsongsbyartist(spotify, uri, cb)
{
  spotify.get(uri, function(err, result)
  {
    var toptracks = [];
    for (i in result.topTrack)
    {
      var ctt = result.topTrack[i];
      if (ctt.country == "CH")
      {
        toptracks = ctt.track;
      }
    }
    console.log(toptracks);

    if (toptracks.length == 0)
    {
      toptracks = result.topTrack;
    }
    //return;
    for (i in toptracks)
    {
      toptracks[i] = spotutil.gid2uri("track", toptracks[i].gid);
    }
    cb(result.name, toptracks);
  });
}

function getsongsbyplaylist(spotify, uri, cb)
{
  if (typeof(cb) != "function")
  {
    cb = function() {};
  }
  spotify.playlist(uri, function(err, playlist)
  {
    console.log(playlist);
    console.log(playlist.contents.size);
    cb(playlist.contents, playlist);
  });
}

function parsequotes(string)
{
  string = string.toString().replace(/\"/g, "\\\"");
  string = string.toString().replace(/\`/g, "\\\`");
  return string;
}

var dospotifylogin = function(spotify, callback)
{
  if (!spotify)
  {
    //Nothing
  }
  else
  {
    spotify.disconnect();
  }

  if (!callback || typeof(callback) != "function")
  {
    callback = function() {};
  }
  Spotify.login("{YOUR USERNAME}", "{YOUR PASSWORD}", callback);
};

dospotifylogin(null, afterlogin);

function afterlogin(err, spotify, su_i)
{
  if (err) throw err;
  if (!su_i) var su_i = 0;
  // first get a "Track" instance from the track URI
  var parsespotifyuri = function(su_i, spotifyuri, spotify)
  {
    if (su_i == spotifyuri.length)
    {
      console.log("Download done, disconnecting from spotify...");
      spotify.disconnect();
      console.log("Disconnected from Spotify, bye bye!");
      process.exit(code = 0);
    }

    console.log(spotifyuri[su_i]);
    console.log("Trying to get uri type...");
    try
    {
      var uritype = Spotify.uriType(spotifyuri[su_i]);
      cconsole.log("#green[Got uri type! " + uritype + "]");
    }
    catch (error)
    {
      cconsole.log("#red[Error! Uri for \"" + spotifyuri[su_i] + "\" not recognized!]");
      cconsole.log("#red[Skipping...]");
      su_i++;
      parsespotifyuri(su_i, spotifyuri, spotify);
    }

    if (uritype == "track")
    {
      getsongbyuri(null, spotify, spotifyuri[su_i], __dirname + "/songs/songs/", 0, function(mp3, track)
      {
        try
        {
          var res = fs.statSync(mp3);
        }
        catch (error)
        {
          //console.log(res,error);
          cconsole.log("#red[Error while downloading " + track.artist[0].name + " - " + track.name + "!]");
          if (!res)
          {
            su_i++;
            parsespotifyuri(su_i, spotifyuri, spotify);
            return;
          }
        }
        cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");

        fs.mkdirSync(__dirname + "/songs/covers/", 0777, true);

        track.album.cover.forEach(function(image)
        {
          if (image.size == "LARGE")
          {
            console.log(image.uri);
            var albumcoverdata = "";
            cconsole.log("#yellow[Downloading album cover]");
            var req = request(image.uri);
            req.on("end", function()
            {
              cconsole.log("#green[Album cover downloaded!]");

              cconsole.log("#yellow[Tagging song]");

              asyncblock(function(flow)
              {
                var cmd = 'eyeD3 ' +
                  '-a "' + parsequotes(track.artist[0].name) + '" ' +
                  '-A "' + parsequotes(track.album.name) + '" ' +
                  '-t "' + parsequotes(track.name) + '" ' +
                  '-n "' + parsequotes(track.number) + '" ' +
                  '-d "' + parsequotes(track.discNumber) + '" ' +
                  '-Y ' + parsequotes(track.album.date.year) + ' ' +
                  '--set-encoding=utf8 ' +
                  '--add-image "' + __dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg":FRONT_COVER ' +
                  '"' + mp3 + '"';
                exec(cmd,
                  flow.add());
                console.log(cmd);
                result = flow.wait();
                cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                console.log(result);
                su_i++;
                parsespotifyuri(su_i, spotifyuri, spotify);
              });
            });
            req.pipe(fs.createWriteStream(__dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg'));
          }
        });
      });
    }
    else if (uritype == "playlist")
    {
      //PLAYLIST
      //https://play.spotify.com/album/0wrJWQlkpLPwh2FTHcAMdE
      getsongsbyplaylist(spotify, spotifyuri[su_i], function(tracks, playlist)
      {
        var i = 0;
        fs.mkdirSync(__dirname + "/songs/playlists/" + escapefilename(playlist.attributes.name) + "/", 0777, true);
        var parsetrack = function(tracks, i, playlist, spotify)
        {
          if (i < tracks.items.length)
          {
            getsongbyuri(null, spotify, tracks.items[i].uri, __dirname + "/songs/playlists/" + escapefilename(playlist.attributes.name) + "/", (i + 1), function(mp3, track, spotify, success, reason)
            {
              if (typeof(reason) != "string")
              {
                reason = "";
              }
              if (success == false)
              {
                if (reason != "cached")
                {
                  cconsole.log("#red[Unable to download " + track.artist[0].name + " - " + track.name + "!]");
                }
                i++;
                parsetrack(tracks, i, playlist, spotify);
              }
              else
              {
                try
                {
                  var res = fs.statSync(mp3);
                }
                catch (error)
                {
                  //console.log(res,error);
                  cconsole.log("#red[Error while downloading " + track.artist[0].name + " - " + track.name + "!]");
                  if (!res)
                  {
                    i++;
                    parsetrack(tracks, i, playlist, spotify);
                    return;
                  }
                }


                cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");
                if (typeof(track.album.cover) == "undefined")
                {

                  cconsole.log("#yellow[This song has no album cover]");
                  cconsole.log("#yellow[Tagging song]");
                  asyncblock(function(flow)
                  {
                    var cmd = 'eyeD3 ' +
                      '-a "' + parsequotes(track.artist[0].name) + '" ' +
                      '-A "' + parsequotes(track.album.name) + '" ' +
                      '-t "' + parsequotes(track.name) + '" ' +
                      '-n "' + parsequotes(track.number) + '" ' +
                      '-d "' + parsequotes(track.discNumber) + '" ' +
                      '-Y ' + parsequotes(track.album.date.year) + ' ' +
                      '--set-encoding=utf8 ' +
                      '"' + mp3 + '"';
                    exec(cmd,
                      flow.add());
                    result = flow.wait();
                    cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                    console.log(result);

                    i++;
                    parsetrack(tracks, i, playlist, spotify);
                  });
                }
                else
                {
                  track.album.cover.forEach(function(image)
                  {
                    if (image.size == "LARGE")
                    {
                      console.log(image.uri);
                      var albumcoverdata = "";
                      cconsole.log("#yellow[Downloading album cover]");
                      var req = request(image.uri);
                      req.on("end", function()
                      {
                        cconsole.log("#green[Album cover downloaded!]");
                        cconsole.log("#yellow[Tagging song]");

                        asyncblock(function(flow)
                        {
                          var cmd = 'eyeD3 ' +
                            '-a "' + parsequotes(track.artist[0].name) + '" ' +
                            '-A "' + parsequotes(track.album.name) + '" ' +
                            '-t "' + parsequotes(track.name) + '" ' +
                            '-n "' + parsequotes(track.number) + '" ' +
                            '-d "' + parsequotes(track.discNumber) + '" ' +
                            '-Y ' + parsequotes(track.album.date.year) + ' ' +
                            '--set-encoding=utf8 ' +
                            '--add-image "' + __dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg":FRONT_COVER ' +
                            '"' + mp3 + '"';
                          exec(cmd,
                            flow.add());
                          result = flow.wait();
                          cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                          console.log(result);

                          i++;
                          parsetrack(tracks, i, playlist, spotify);
                        });
                      });
                      req.pipe(fs.createWriteStream(__dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg'));
                    }
                  });
                }
              }

            });
          }
          else
          {
            //END
            su_i++;
            parsespotifyuri(su_i, spotifyuri, spotify);
          }
        }
        parsetrack(tracks, i, playlist, spotify);
      });
    }
    else if (uritype == "album")
    {
      getsongsbyalbum(spotify, spotifyuri[su_i], function(tracks, album)
      {
        var albumname = album.artist[0].name + " - " + album.name;
        var i = 0;
        fs.mkdirSync(__dirname + "/songs/albums/" + escapefilename(albumname) + "/", 0777, true);
        album.cover.forEach(function(image)
        {
          if (image.size == "LARGE")
          {
            request(image.uri).pipe(fs.createWriteStream(__dirname + "/songs/albums/" + escapefilename(albumname) + "/" + "cover.jpg")).on("finish", function()
            {
              cconsole.log("#green[Album cover downloaded!]");
            });
          }
        });
        var parsetrack = function(tracks, i, album, spotify)
        {
          if (i < tracks.length)
          {
            getsongbyuri(null, spotify, tracks[i], __dirname + "/songs/albums/" + escapefilename(albumname) + "/", (i + 1), function(mp3, track, spotify)
            {
              try
              {
                var res = fs.statSync(mp3);
              }
              catch (error)
              {
                console.log(res, error);
                if (!res)
                {
                  i++;
                  parsetrack(tracks, i, album, spotify);
                  return;
                }
              }
              cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");
              console.log(mp3);

              try
              {
                asyncblock(function(flow)
                {
                  var cmd = 'eyeD3 ' +
                    '-a "' + parsequotes(track.artist[0].name) + '" ' +
                    '-A "' + parsequotes(track.album.name) + '" ' +
                    '-t "' + parsequotes(track.name) + '" ' +
                    '-n "' + parsequotes(track.number) + '" ' +
                    '-d "' + parsequotes(track.discNumber) + '" ' +
                    '-Y ' + parsequotes(track.album.date.year) + ' ' +
                    '--set-encoding=utf8 ' +
                    '--add-image "' + __dirname + "/songs/albums/" + escapefilename(albumname) + '/cover.jpg":FRONT_COVER ' +
                    '"' + mp3 + '"';
                  console.log(cmd);
                  exec(cmd,
                    flow.add());
                  result = flow.wait();
                  cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                  console.log(result);
                  i++;
                  parsetrack(tracks, i, album, spotify);
                });
                //console.log(result);
              }
              catch (error)
              {
                cconsole.log("#red[Failed to tag MP3!]");
                console.log(error);
                i++;
                parsetrack(tracks, i, album, spotify);
              }
            });
          }
          else
          {
            //END
            su_i++;
            parsespotifyuri(su_i, spotifyuri, spotify);
          }
        }
        parsetrack(tracks, i, album, spotify);
      });
    }
    else if (uritype == "artist")
    {
      gettopsongsbyartist(spotify, spotifyuri[su_i], function(artist, toptracks)
      {
        fs.mkdirSync(__dirname + "/songs/artists/" + escapefilename(artist) + "/", 0777, true);
        var parsetrack = function(tracks, i, artist, spotify)
        {
          if (i < tracks.length)
          {
            getsongbyuri(null, spotify, tracks[i], __dirname + "/songs/artists/" + escapefilename(artist) + "/", (i + 1), function(mp3, track, spotify)
            {
              try
              {
                var res = fs.statSync(mp3);
              }
              catch (error)
              {
                console.log(res, error);
                if (!res)
                {
                  i++;
                  parsetrack(tracks, i, artist, spotify);
                  return;
                }
              }
              cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");
              console.log(mp3);

              try
              {
                asyncblock(function(flow)
                {
                  var cmd = 'eyeD3 ' +
                    '-a "' + parsequotes(track.artist[0].name) + '" ' +
                    '-A "' + parsequotes(track.album.name) + '" ' +
                    '-t "' + parsequotes(track.name) + '" ' +
                    '-n "' + parsequotes(track.number) + '" ' +
                    '-d "' + parsequotes(track.discNumber) + '" ' +
                    '-Y ' + parsequotes(track.album.date.year) + ' ' +
                    '--set-encoding=utf8 ' +
                    //'--add-image "' + __dirname + "/songs/artists/" + escapefilename(artist) + '/cover.jpg":FRONT_COVER ' +
                    '"' + mp3 + '"';
                  console.log(cmd);
                  exec(cmd,
                    flow.add());
                  result = flow.wait();
                  cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                  console.log(result);
                  i++;
                  parsetrack(tracks, i, artist, spotify);
                });
                //console.log(result);
              }
              catch (error)
              {
                cconsole.log("#red[Failed to tag MP3!]");
                console.log(error);
                i++;
                parsetrack(tracks, i, artist, spotify);
              }
            });
          }
          else
          {
            //END
            su_i++;
            parsespotifyuri(su_i, spotifyuri, spotify);
          }
        }
        parsetrack(toptracks, 0, artist, spotify);
      });
    }
  }

  parsespotifyuri(su_i, spotifyuri, spotify);
}