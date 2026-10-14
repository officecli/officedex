# makensis for building the OfficeDex Windows installer on a non-Windows host.
#
# Homebrew's makensis (3.13) aborts with std::bad_alloc on current macOS before
# reading a single line of script, bottle and source build alike, so the Mac
# flow runs Debian's packaged NSIS in a container instead
# (scripts/nsis/makensis-docker.sh). NSIS cross-compiles Windows installers on
# any host; only the compiler runs here, the stubs it packs are Windows code.
FROM debian:bookworm-slim
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends nsis \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["makensis"]
