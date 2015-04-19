var Spotify = require('spotify-web');
var lame = require('lame');
var Speaker = require('speaker');
var fs = require('fs');
var nodefs = require('node-fs');
var path = require('path');
var request = require('request');
var colorize = require('colorize');
var cconsole = colorize.console;
var StringDecoder = require('string_decoder').StringDecoder;
var asyncblock = require('asyncblock');
var exec = require('child_process').exec;

console.log("Spotify Downloader");

// determine the URI to play, ensure it's a "track" URI
var spotifyuri = new Array();
var downloadplaylists = Array();
var downloadtracks = Array();
var downloadalbums = Array();


for(i in process.argv)
{
  if(i == 0 || i == 1)
  {
    continue;
  }
  var s_uri = process.argv[i].match(/https:\/\/play\.spotify\.com\/(.*?)\/(.*?)(\/|)$/i);
  // https://play.spotify.com/user/1172546215/playlist/488IX9RsdSFTaZuItjYGY7
  var p_uri = process.argv[i].match(/https:\/\/play\.spotify\.com\/user\/(.*?)\/playlist\/(.*?)$/i);
  if(p_uri)
  {
    p_uri = "spotify:user:"+p_uri[1]+":playlist:"+p_uri[2];
    console.log(p_uri);
    if(Spotify.uriType(p_uri) == "playlist")
    {
      downloadplaylists.push(p_uri);
      spotifyuri.push(p_uri);
    }
  }
  else if(s_uri)
  {
    s_uri = "spotify:"+s_uri[1]+":"+s_uri[2];
    console.log(s_uri);
    if(Spotify.uriType(s_uri) == "track")
    {
      downloadtracks.push(s_uri);
      spotifyuri.push(s_uri);
    }
    if(Spotify.uriType(s_uri) == "album")
    {
      downloadalbums.push(s_uri);
      spotifyuri.push(s_uri);
    }
  }
}

if(spotifyuri.length == 0)
{
  console.log("No valid args passed!");
  process.exit(code=0);
}

//READY TO DOWNLOAD
cconsole.log("#blue[Ready to download "+downloadalbums.length+" albums, " + downloadtracks.length + " songs and "+ downloadplaylists.length + " playlists...");

// initiate the Spotify session

function escapefilename(name)
{
  //name = name.replace("/","_");
  name = name.replace(/[^A-Za-z0-9_\-\(\)\. \']/g,"_");
  return name;
}

function getsongbyuri(err,spotify,uri,savepath,count,cb)
{
  if(typeof(cb) != "function")
  {
    cb = function(){};
  }
  var sp = spotify;
  console.log(uri);
  spotify.get(uri, function (err, track) {
    if (err)
    {
      cconsole.log("#red[GET ERROR!]");
      console.log(err);
      setTimeout(function()
      {
        getsongbyuri(null,spotify,uri,savepath,count,cb);
      },3000);
      return;
    }
    console.log('Trying to download %s - %s ...', track.artist[0].name, track.name);

    try{
      var play = track.play();
    }
    catch(error)
    {
      cconsole.log("#red[Error while downloading track, skipping to next]");
      cb(savepath + track.artist[0].name+ " - " + track.name +".mp3",track,spotify,false);
      return;
    }

    play.on("error",function(err)
    {
      if(err.code == 8)
      {
        //Rate limit exceded!
        console.log("Retrying to download...");
        setTimeout(function()
        {
          dospotifylogin(spotify,function(err,spotify)
          {
            if(err) throw err;
            sp = spotify;
            getsongbyuri(null,spotify,uri,savepath,count,cb);
          });
        },10000);
      }
      if(typeof(err.message) != "undefined")
      {
        console.log(err.message);
        if(err.message.toString().indexOf("not playable in country") != -1)
        {
          cconsole.log("#red[Track not playable in your country!]");
          cb(savepath + track.artist[0].name+ " - " + track.name +".mp3",track,spotify,false);
        }
        else
        {
          cconsole.log("#red[ERROR:"+ err.message+"]");
        }
      }
      else
      {
        cconsole.log("#red[ERROR!!!]");
        console.log(err);
      }
    });

    if(count == 0)
    {
      tracknum = "";
    }
    else
    {
      tracknum = count+". ";
    }

    var date = new Date();
    var output = fs.createWriteStream(savepath + escapefilename(tracknum + track.artist[0].name+ " - " + track.name) +".mp3");
    play.pipe(output);

    play.on("data",function(data)
    {

    }).on("end",function()
    {
      //fs.writeFileSync("/var/node/spotify/1.mp3",buffer);
      //spotify.disconnect();
      cb(savepath + escapefilename(tracknum + track.artist[0].name+ " - " + track.name) +".mp3",track,spotify);
    });

  });
}

function getsongsbyalbum(spotify,uri,cb)
{
  if(typeof(cb) != "function")
  {
    cb = function(){};
  }
  try
  {
    spotify.on("error",function(a)
    {
      console.log("ERRORE!",a);
    });
    spotify.get(uri, function (err, album)
    {
      if(err)
      {
        cconsole.log("#red[ERROR!]");
        console.log(err);
      }
      var tracks = [];
      album.disc.forEach(function (disc) {
        if (!Array.isArray(disc.track)) return;
        tracks.push.apply(tracks, disc.track);
      });
      
      var tracks = tracks.map(function(t){ return t.uri; });
      cb(tracks,album);
    });
  }
  catch(error)
  {
    console.log("ERRORE!",error);
  }
}

function getsongsbyplaylist(spotify,uri,cb)
{
  if(typeof(cb) != "function")
  {
    cb = function(){};
  }
  spotify.playlist(uri, function (err, playlist)
  {
    console.log(playlist);
    console.log(playlist.contents.size);
    cb(playlist.contents,playlist);
  });
}

var dospotifylogin = function(spotify,callback)
{
  if(!spotify)
  {
    //Nothing
  }
  else
  {
    spotify.disconnect();
  }

  if(!callback || typeof(callback) != "function")
  {
    callback = function() { };
  }
  Spotify.login("{YOUR_USERNAME}", "{YOUR PASSWORD}", callback);
};

dospotifylogin(null,afterlogin);

function afterlogin(err,spotify,su_i)
{
  if (err) throw err;
  if(!su_i) var su_i = 0;
  // first get a "Track" instance from the track URI
  var parsespotifyuri = function(su_i,spotifyuri,spotify)
  {
    if(su_i == spotifyuri.length)
    {
      console.log("Download done, disconnecting from spotify...");
      spotify.disconnect();
      console.log("Disconnected from Spotify, bye bye!");
      process.exit(code=0);
    }

    console.log(spotifyuri[su_i]);
    try
    {
      var uritype = Spotify.uriType(spotifyuri[su_i]);
    }
    catch(error)
    {
      cconsole.log("#red[Error! Uri for \""+spotifyuri[su_i]+"\" not recognized!]");
      cconsole.log("#red[Skipping...]");
      su_i++;
      parsespotifyuri(su_i,spotifyuri,spotify);
    }

    if(uritype == "track")
    {
      getsongbyuri(null,spotify,spotifyuri[su_i],__dirname + "/songs/songs/",0,function(mp3,track)
      {
        cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");

        fs.mkdirSync(__dirname + "/songs/covers/",0777,true);

        track.album.cover.forEach(function (image) {
          if(image.size == "LARGE")
          {
            console.log(image.uri);
            var albumcoverdata = "";
            cconsole.log("#yellow[Downloading album cover]");
            var req = request(image.uri);
            req.on("end",function()
            {
              cconsole.log("#green[Album cover downloaded!]");

              cconsole.log("#yellow[Tagging song]");

              asyncblock(function (flow) {
                var cmd = 'eyeD3 ' + 
                  '-a "' + track.artist[0].name + '" ' +
                  '-A "'+ track.album.name +'" ' +
                  '-t "'+ track.name +'" ' +
                  '-n "'+ track.number + '" ' +
                  '-d "' + track.discNumber + '" ' +
                  '-Y ' + track.album.date.year + ' ' +
                  '--add-image "' + __dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg":FRONT_COVER ' +
                  '--set-encoding utf8 ' +
                  '"' + mp3 + '"';
                exec(cmd,
                flow.add());
                result = flow.wait();
                cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                console.log(result);
                su_i++;
                parsespotifyuri(su_i,spotifyuri,spotify);
              });
            });
            req.pipe(fs.createWriteStream(__dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg'));
          }
        });
      });
    }
    else if(uritype == "playlist")
    {
      //PLAYLIST
      //https://play.spotify.com/album/0wrJWQlkpLPwh2FTHcAMdE
      getsongsbyplaylist(spotify,spotifyuri[su_i],function(tracks,playlist)
      {
        var i = 0;
        fs.mkdirSync(__dirname + "/songs/playlists/" + escapefilename(playlist.attributes.name) + "/",0777,true);
        var parsetrack = function(tracks,i,playlist,spotify)
        {
          if(i<tracks.items.length)
          {
            getsongbyuri(null,spotify,tracks.items[i].uri,__dirname + "/songs/playlists/" + escapefilename(playlist.attributes.name) + "/",(i+1),function(mp3,track,spotify,success)
            {
              if(success == false)
              {
                cconsole.log("#red[Unable to download "+track.artist[0].name + " - " + track.name+"!]");
                i++;
                parsetrack(tracks,i,playlist,spotify);
              }
              else
              {
                cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");
                track.album.cover.forEach(function (image) {
                  if(image.size == "LARGE")
                  {
                    console.log(image.uri);
                    var albumcoverdata = "";
                    cconsole.log("#yellow[Downloading album cover]");
                    var req = request(image.uri);
                    req.on("end",function()
                    {
                      cconsole.log("#green[Album cover downloaded!]");

                      cconsole.log("#yellow[Tagging song]");

                      asyncblock(function (flow) {
                        var cmd = 'eyeD3 ' + 
                          '-a "' + track.artist[0].name + '" ' +
                          '-A "'+ track.album.name +'" ' +
                          '-t "'+ track.name +'" ' +
                          '-n "'+ track.number + '" ' +
                          '-d "' + track.discNumber + '" ' +
                          '-Y ' + track.album.date.year + ' ' +
                          '--add-image "' + __dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg":FRONT_COVER ' +
                          '--set-encoding utf8 ' +
                          '"' + mp3 + '"';
                        exec(cmd,
                        flow.add());
                        result = flow.wait();
                        cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                        console.log(result);

                        i++;
                        parsetrack(tracks,i,playlist,spotify);
                      });
                    });
                    req.pipe(fs.createWriteStream(__dirname + "/songs/covers/" + escapefilename(track.artist[0].name + ' - ' + track.name) + '_cover.jpg'));
                  }
                });
              }

            });
          }
          else
          {
            //END
            su_i++;
            parsespotifyuri(su_i,spotifyuri,spotify);
          }
        }
        parsetrack(tracks,i,playlist,spotify);
      });
    }
    else if(uritype == "album")
    {
      getsongsbyalbum(spotify,spotifyuri[su_i],function(tracks,album)
      {
        var albumname = album.artist[0].name + " - " + album.name;
        var i = 0;
        fs.mkdirSync(__dirname + "/songs/albums/" + escapefilename(albumname) + "/",0777,true);
        album.cover.forEach(function (image) {
          if(image.size == "LARGE")
          {
            request(image.uri).pipe(fs.createWriteStream(__dirname + "/songs/albums/" + escapefilename(albumname) + "/" + "cover.jpg"))
          }
        });
        var parsetrack = function(tracks,i,album,spotify)
        {
          if(i<tracks.length)
          {
            getsongbyuri(null,spotify,tracks[i],__dirname + "/songs/albums/" + escapefilename(albumname) + "/",(i+1),function(mp3,track,spotify)
            {
              cconsole.log("#green[Downloaded " + track.artist[0].name + " - " + track.name + " succesfully!]");
              console.log(mp3);
              asyncblock(function (flow) {
                var cmd = 'eyeD3 ' + 
                  '-a "' + track.artist[0].name + '" ' +
                  '-A "'+ track.album.name +'" ' +
                  '-t "'+ track.name +'" ' +
                  '-n "'+ track.number + '" ' +
                  '-d "' + track.discNumber + '" ' +
                  '-Y ' + track.album.date.year + ' ' +
                  '--add-image "' + __dirname + "/songs/albums/" + escapefilename(albumname) + '/cover.jpg":FRONT_COVER ' +
                  '--set-encoding utf8 ' +
                  '"' + mp3 + '"';
                exec(cmd,
                flow.add());
                result = flow.wait();
                cconsole.log("#green[Done tagging song! Here you can see tag result:]");
                console.log(result);

                i++;
                parsetrack(tracks,i,album,spotify);
              });
            });
          }
          else
          {
            //END
            su_i++;
            parsespotifyuri(su_i,spotifyuri,spotify);
          }
        }
        parsetrack(tracks,i,album,spotify);
      });
    }
  }

  parsespotifyuri(su_i,spotifyuri,spotify);
}